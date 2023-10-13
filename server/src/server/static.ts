import bodyParser from "body-parser";
import * as child_process from "child_process";
import { Console } from "console";
import express from "express";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { startStats } from "./stats";

// 5 minute setup + 1 minute measured + 10 sec for final latency
// receipts.
const EXP_LENGTH_MS = 370 * 1000;
// After the measured period, we wait 10 sec for one user to record
// a 5 sec profile.
const PROFILE_LENGTH_MS = 10 * 1000;

const SCENARIOS = ["allActive", "noQuill"];

// Maps framework name to its server's Node script.
const FRAMEWORKS: Record<string, string> = {
  automerge: "../../automerge/automerge-server.js",
  automergeRepo: "../../automerge/automerge-repo-server.mjs",
  collabs: "../../node_modules/@collabs/ws-server/bin/collabs-ws-server.js",
  collabsNoVC: "../../node_modules/@collabs/ws-server/bin/collabs-ws-server.js",
  yjs: "../../node_modules/y-websocket/bin/server.js",
  sharedb: "../../sharedb/sharedb-server.js",
  gdocs: "fake",
};

(async function () {
  const args = process.argv.slice(2);
  const logFolder = args[0];
  const scenario = args[1];
  const numUsers = Number.parseInt(args[2]);
  const framework = args[3];
  const trial = args[4];
  const options = args[5] ?? "";
  const collectLogs = options.includes("c");
  const includeLocal = options.includes("l");
  const exitAtEnd = options.includes("x");
  const senderBatch = options.includes("b");
  const gdocsUrl = args[6];

  if (
    args.length < 5 ||
    args.length > 7 ||
    !SCENARIOS.includes(scenario) ||
    FRAMEWORKS[framework] === undefined ||
    isNaN(numUsers)
  ) {
    console.log("Error: Invalid args\n");
    console.log(
      "Usage: npm start <logFolder> <scenario> <numUsers> <framework> <trial> [options [gdocs URL]]\nwhere:"
    );
    console.log(
      "- logFolder is the root folder for all experiments' log files"
    );
    console.log("- scenario is one of:", JSON.stringify(SCENARIOS));
    console.log(
      "- numUsers is the number of clients to wait for before starting the experiment."
    );
    console.log(
      "- framework is one of:",
      JSON.stringify([...Object.keys(FRAMEWORKS)])
    );
    console.log(
      "- trial is the name for this trial's log folder. The logs are placed in <logFolder>/<exp params>/<trial>/."
    );
    console.log('- options may include chars (e.g. "xc"):');
    console.log(
      " - 'c' to collect log files sent by client containers (written to logFolder)"
    );
    console.log(
      "  - 'l' to include localhost traffic in the per-process network stats"
    );
    console.log("  - 'x' to exit when the experiment ends");
    console.log(
      "  - 'b' to enable 1 second sender-side batching (CRDT frameworks only)"
    );
    console.log(
      ' - gdocs URL is the editable link for this experiment\'s Google Doc, if using framework "gdocs"'
    );
    console.log(
      "To set the port, use the PORT environment variable (default: 8080).\n" +
        "The framework server runs on PORT + 1."
    );
    process.exit(1);
  }

  const port =
    process.env.PORT === undefined ? 8080 : Number.parseInt(process.env.PORT);

  // Destination for log files.
  const numUsersPadded = String(numUsers).padStart(3, "0");
  const trialFolder = path.join(
    logFolder,
    `${scenario}-${numUsersPadded}-${framework}/${trial}`
  );
  await fsPromises.mkdir(trialFolder, { recursive: true });

  const serverLogHandle = await fsPromises.open(
    path.join(trialFolder, "server.log"),
    "w"
  );
  const logger = new Console(serverLogHandle.createWriteStream());

  logger.log(
    JSON.stringify({
      type: "info",
      process: "server",
      scenario,
      numUsers,
      framework,
      includeLocal,
      senderBatch,
      url: `http://localhost:${port}/`,
      gdocsUrl,
    })
  );

  let state: "waiting" | "running" | "logs" | "ended" = "waiting";

  let stopStats: () => void;
  if (framework !== "gdocs") {
    // Framework-specific server.
    // We run its Node script directly because "npm run" spawns layered shells,
    // which are harder to measure & kill.
    const server = child_process.spawn(
      "node",
      [path.join(__dirname, FRAMEWORKS[framework])],
      {
        env: {
          ...process.env,
          PORT: `${port + 1}`,
          HOST: "0.0.0.0",
        },
      }
    );
    server.stdout.on("data", (msg) => logger.log(msg.toString()));
    server.stderr.on("data", (msg) => console.error(msg.toString()));
    async function onServerError(err: unknown) {
      console.error("Framework server exited with error", err);
      if (state === "waiting" || state === "running") {
        console.error("\tTerminating.");
        await serverLogHandle.close();
        process.exit(1);
      }
    }
    server.on("close", (code) => {
      logger.log(JSON.stringify({ type: "serverClose", code }));
      if (code !== 0) onServerError("close code " + code);
    });
    server.on("error", onServerError);
    process.on("exit", () => {
      // Also kill framework server.
      if (server.exitCode === null) server.kill();
    });

    await new Promise((resolve, reject) => {
      server.on("spawn", resolve);
      server.on("error", reject);
    });
    console.log("Framework server pid:", server.pid);

    // Stats.
    stopStats = startStats(server.pid!, 1, includeLocal, logger);
  } else stopStats = () => {};

  const readyResponses = new Set<express.Response>();
  const profileResponses = new Set<express.Response>();
  const endResponses = new Set<express.Response>();
  const logResponses = new Map<express.Response, string>();
  let startTime = -1;

  // "/ready" is used to start the experiment: each user calls it once ready
  // (connected to WebSocket server); we respond once numUsers are ready;
  // then each client prints "START,<params>", causing its puppeteer to start the experiment.
  const app = express();
  app.post("/ready", (req, res) => {
    readyResponses.add(res);
    logger.log(
      JSON.stringify({
        type: "clientReady",
        time: Date.now(),
        readyUsers: readyResponses.size,
      })
    );

    if (readyResponses.size === numUsers) {
      // Respond to all of them, starting the experiment.
      setTimeout(() => {
        startTime = Date.now();
        logger.log(JSON.stringify({ type: "start", time: Date.now() }));
        console.log("Experiment starting (all clients connected).");
        let i = 0;
        for (const readyRes of readyResponses) {
          readyRes.send(
            JSON.stringify({
              scenario,
              numUsers,
              userID: i,
              framework,
              includeLocal,
              senderBatch,
            })
          );
          i++;
        }
        setTimeout(endExp, EXP_LENGTH_MS);
        state = "running";
      }, 0);
    } else if (readyResponses.size > numUsers) {
      logger.log(
        JSON.stringify({
          type: "warning",
          msg: `${readyResponses.size} /ready requests, only expected ${numUsers}`,
        })
      );
    }
  });

  // "/profile" is used to tell some clients to record expensive stats
  // (CPU profiles, doc savedSizes).
  // We do this after the measured part of the experiment
  // and give it 10 sec to complete before ending the trial.
  app.post("/profile", (req, res) => profileResponses.add(res));

  // "/end" is used to stop clients gracefully at the end of the experiment:
  // we respond just before killing the server, the client prints "END", and
  // puppeteer exits.
  app.post("/end", (req, res) => endResponses.add(res));

  // "/log" is used by container clients to send their log files to us.
  // We save them each to a separate file in trialFolder.
  const logsDone = new Promise<void>((resolve, reject) => {
    if (!collectLogs) return;

    let clientLogNum = 0;
    app.use("/log", bodyParser.text({ limit: "20mb" }));
    app.post("/log", async (req, res) => {
      if (typeof req.body !== "string") {
        console.error("Warning: /logs got bad req.body", req.body);
        res.send("Error: Bad Content-Type\n");
        return;
      }

      const ourFile = `client${clientLogNum++}.log`;
      try {
        await fsPromises.writeFile(path.join(trialFolder, ourFile), req.body);

        // We wait to respond until all logs are saved. That way, one client
        // can't die before the others are done and take them down with it
        // (happens with AWS Fargate "essential" containers).
        logResponses.set(res, "Log saved to " + ourFile + "\n");
        if (logResponses.size === numUsers) resolve();
      } catch (err) {
        reject(err);
        throw err;
      } finally {
        if (state === "waiting" || state === "running") {
          console.error("Client sent logs early; it must have exited early.");
          console.error("\tTerminating.");
          // Wait a bit in case we get other client logs with debug info.
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await serverLogHandle.close();
          process.exit(2);
        }
      }
    });
  });

  // Status page for human viewers.
  app.get("/status", (req, res) => {
    let status = "<html><body>\n";
    status += `${scenario}, ${framework}, ${numUsers} users, collectLogs=${collectLogs}, local=${includeLocal}, exit=${exitAtEnd}, senderBatch=${senderBatch}<br />\n`;

    if (framework === "gdocs") {
      status += `<a href=${gdocsUrl}>${gdocsUrl}</a><br />\n`;
    }

    switch (state) {
      case "waiting":
        status += `Waiting for clients, ${readyResponses.size}/${numUsers} connected`;
        break;
      case "running":
        status += `Experiment running, ${Math.floor(
          (Date.now() - startTime) / 1000
        )}/${Math.floor((EXP_LENGTH_MS + PROFILE_LENGTH_MS) / 1000)} seconds`;
        break;
      case "logs":
        status += `Collecting logs, ${logResponses.size}/${numUsers} saved`;
        break;
      case "ended":
        status += "Experiment ended.";
        break;
    }

    if (state !== "ended") {
      // Until the experiment ends, refresh the page every 10 sec.
      status +=
        "\n<script>setTimeout(() => window.location.reload(), 10000);</script>\n";
    }

    status += "</body></html>";
    res.send(status);
  });

  // Serve build/site under /.
  // Except, if they request the main page, redirect to add params
  // specifying the framework, scenario, and senderBatch options.
  const encodedGdocsUrl =
    gdocsUrl === undefined ? undefined : encodeURIComponent(gdocsUrl);
  app.get("/", (req, res, next) => {
    if (
      (req.path === "/" || req.path === "index.html") &&
      !(
        req.query["framework"] === framework &&
        req.query["scenario"] === scenario &&
        req.query["senderBatch"] === `${senderBatch}` &&
        req.query["gdocsUrl"] === gdocsUrl
      )
    ) {
      res.redirect(
        `?framework=${framework}&scenario=${scenario}&senderBatch=${senderBatch}` +
          (encodedGdocsUrl === undefined ? "" : `&gdocsUrl=${encodedGdocsUrl}`)
      );
    } else next();
  });
  app.use("/", express.static(path.join(__dirname, "../../build/")));

  app.listen(port, () => {
    logger.log(JSON.stringify({ type: "ready", time: Date.now() }));
    console.log(`Experiment server listening at http://localhost:${port}/`);
  });

  /** Ends the experiment. */
  async function endExp() {
    // Official end of the measured period (including the extra 10 seconds for
    // final latency receipts).
    logger.log(JSON.stringify({ type: "end", time: Date.now() }));

    // Let the clients run for 10 more sec while client 0 records a CPU profile.
    for (const profileResponse of profileResponses) {
      profileResponse.send("Profile");
    }
    await new Promise((resolve) => setTimeout(resolve, PROFILE_LENGTH_MS));

    // Experiment over, except for collecting logs.
    if (collectLogs) {
      state = "logs";
      console.log("Collecting client logs...");
    } else state = "ended";

    for (const endRes of endResponses) {
      endRes.send("End");
    }

    stopStats();

    if (collectLogs) {
      await logsDone;
      for (const [res, text] of logResponses) res.send(text);
      state = "ended";
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await serverLogHandle.close();

    // Everything over. However, we keep the server running so you can open the
    // page and look at it, unless you passed the "x" option.
    console.log("END EXPERIMENT");

    if (exitAtEnd) process.exit(0);
    else {
      console.log(
        "You may kill this process, or open the site to play with it."
      );
    }
  }
})();
