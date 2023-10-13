import path from "path";
import puppeteer, { Page } from "puppeteer";
import { EditorUser, GdocsUser, QuillUser } from "./editor_user";
import { allActive } from "./scenarios/all_active";
import { startStats } from "./stats";

const PROFILE_LENGTH_MS = 5000;

export async function runBenchmark(url: string) {
  console.log(
    JSON.stringify({
      type: "launch",
      process: "client",
      time: Date.now(),
      url,
    })
  );

  // Configure browser.
  const browser = await puppeteer.launch({
    // Change this to false and comment out args (below)
    // if you want to watch the clients live.
    headless: true,
    userDataDir: path.join(__dirname, "../userData"),
    // Restrict Chromium to a single process, so we can measure just that
    // process's stats.
    args: ["--single-process", "--no-zygote", "--no-sandbox"],
  });

  let startResolve!: (params: string) => void;
  const startPromise = new Promise<string>((resolve) => {
    startResolve = resolve;
  });
  let gdocsResolve!: (gdocsUrl: string) => void;
  const gdocsPromise = new Promise<string>((resolve) => {
    gdocsResolve = resolve;
  });

  // Create a page.
  const controlPage = await browser.newPage();
  controlPage.on("console", (msg) => {
    const text = msg.text();
    // Use a short output form for sigils, since they dominate the output
    // and can fill 100s of MB total.
    if (text.startsWith("S:")) console.log(text + "," + Date.now());
    else if (text.startsWith("START:")) {
      startResolve(text.slice(6));
    } else if (text.startsWith("PROFILE")) {
      const args = text.slice(7);
      const highFreq = args === "1";
      void recordProfile(highFreq);
    } else if (text === "END") exit("END");
    else if (text.startsWith("GDOCS:")) {
      gdocsResolve(text.slice(6));
    } else if (msg.type() === "error") {
      console.log("app ERROR", msg.text());
      if (msg.text().startsWith("Fetch failure:")) {
        // Assume the server has exited, so we should exit too.
        exit("Fetch failure (server exited?)", 2);
      }
    } else {
      console.log(
        JSON.stringify({ type: "app", time: Date.now(), log: msg.text() })
      );
    }
  });
  controlPage.on("pageerror", (err) => {
    console.log("app ERROR", err);
  });

  // Load webpage.
  await controlPage.goto(url);

  // Setup the editor.
  const gdocsUrl = await gdocsPromise;
  const isGdocs = gdocsUrl !== "false";

  let expPage: Page;
  let editorUser: EditorUser;
  if (isGdocs) {
    // Load Gdocs in a new page. We only use
    // controlPage for coordinating with the experiment server.
    expPage = await browser.newPage();
    expPage.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("S:")) console.log(text + "," + Date.now());
      else {
        console.log(
          JSON.stringify({ type: "app", time: Date.now(), log: msg.text() })
        );
      }
    });
    expPage.on("pageerror", (err) => {
      console.log("app ERROR", err);
    });

    editorUser = new GdocsUser(expPage, gdocsUrl);
  } else {
    expPage = controlPage;
    editorUser = new QuillUser(expPage);
  }

  await editorUser.setup();

  console.log(JSON.stringify({ type: "puppeteerReady", time: Date.now() }));

  // Tell controlPage that we're ready, and that it's being controlled by
  // puppeteer.
  await controlPage.evaluate(`window.puppeteerReady();`);

  const params = await startPromise;
  const paramsParsed = JSON.parse(params) as {
    scenario: "allActive" | "noQuill";
    numUsers: number;
    userID: number;
    includeLocal: boolean;
    // Other fields are printed in the info log but not used directly.
  };

  // Start experiment.
  console.log(
    JSON.stringify({
      type: "info",
      process: "client",
      url,
      ...paramsParsed,
    })
  );
  console.log(JSON.stringify({ type: "start", time: Date.now() }));

  // Stats.
  // Less frequent to prevent slowing down containers too much.
  startStats(browser.process()!.pid!, 10, paramsParsed.includeLocal);

  switch (paramsParsed.scenario) {
    case "allActive":
    case "noQuill":
      await allActive(
        expPage,
        editorUser,
        paramsParsed.numUsers,
        paramsParsed.userID
      );
      break;
    default:
      throw new Error("Unrecognized scenario: " + paramsParsed.scenario);
  }

  // Triggered on userID 0 at the end of the measured period.
  // We record a CPU profile for 5 seconds (out of 10 seconds the server
  // gives us) while every client is still running.
  async function recordProfile(highFreq: boolean) {
    const devtools = await expPage.target().createCDPSession();
    await devtools.send("Profiler.enable");
    if (highFreq) {
      // highFreq mode: use a sampling interval of 100 mu-sec instead of the
      // default 1000 mu-sec (1 ms).
      // This is more technically accurate, but less realistic (slows things down).
      await devtools.send("Profiler.setSamplingInterval", { interval: 100 });
    }
    await devtools.send("Profiler.start");
    console.log(
      JSON.stringify({ type: "startProfile", highFreq, time: Date.now() })
    );
    setTimeout(async () => {
      const profile = await devtools.send("Profiler.stop");
      console.log(
        JSON.stringify({
          type: "profile",
          time: Date.now(),
          highFreq,
          profile: profile.profile,
        })
      );
    }, PROFILE_LENGTH_MS);
  }

  function exit(reason: string, code = 0): never {
    console.log(JSON.stringify({ type: "exit", reason, time: Date.now() }));
    browser.close();
    process.exit(code);
  }
}
