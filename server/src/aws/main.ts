import * as child_process from "child_process";

/** The min numUsers for which allActive uses the senderBatch option. */
const senderBatchThreshold = 64;

const vcpusPerClient = {
  allActive: 1,
  noQuill: 0.5,
} as const;

/**
 * Give up if the experiment has not started within 3 minutes of starting
 * all clients.
 */
const expStartTimeoutMS = 3 * 60 * 1000;

(async function () {
  const args = process.argv.slice(2);

  const scenario = args[1] as keyof typeof vcpusPerClient;
  const numUsers = Number.parseInt(args[2]);
  const isGdocs = args[3] === "gdocs";

  if (
    args.length < 5 ||
    args.length > 6 ||
    vcpusPerClient[scenario] === undefined ||
    isNaN(numUsers)
  ) {
    console.log("Error: Invalid args\n");
    console.log(
      "Usage: npm run aws <logFolder> <scenario> <numUsers> <framework> <trial> [gdocsUrl]"
    );
    console.log(
      "See the server's usage (`npm start`) for a description of the args."
    );
    process.exit(1);
  }

  const senderBatch =
    scenario === "allActive" && numUsers >= senderBatchThreshold;
  const options = senderBatch ? "xcb" : "xc";

  const url = "http://" + (await getPublicDns()) + ":8080";

  // Start server.
  // To make it possible to kill despite npm's layered shells, detach it and
  // later kill the whole process group.
  const serverArgs = ["start", ...args.slice(0, 5), options];
  if (isGdocs) {
    // gdocsUrl arg
    serverArgs.push(args[5]);
  }
  console.log("Start server: npm", ...serverArgs);
  const server = child_process.spawn("npm", serverArgs, { detached: true });

  server.stdout.on("data", (msg) => console.log(msg.toString()));
  server.stderr.on("data", (msg) => console.error(msg.toString()));
  async function onServerError(err: unknown) {
    console.error("Server exited with error", err);
    process.exit(2);
  }
  server.on("error", onServerError);
  server.on("close", (code) => {
    if (code === 0) {
      console.log("Server exited normally.");
      process.exit(0);
    }
    if (code !== 0) onServerError("close code " + code);
  });

  // When we exit (including via Ctrl+C), also kill server's process group.
  process.on("exit", () => {
    if (server.exitCode === null && server.pid !== undefined) {
      process.kill(-server.pid);
    }
  });
  process.on("SIGINT", () => process.exit(10));
  process.on("SIGQUIT", () => process.exit(10));
  process.on("SIGTERM", () => process.exit(10));

  // Wait for the server to be running.
  await new Promise<void>((resolve) => {
    server.stdout.on("data", (msg) => {
      if (msg.toString().startsWith("Experiment server listening")) resolve();
    });
  });
  console.log("Status page:", `${url}/status`);

  let experimentStarted = false;
  server.stdout.on("data", (msg) => {
    if (msg.toString().startsWith("Experiment starting"))
      experimentStarted = true;
  });

  // Start clients in both regions.
  const vcpus = vcpusPerClient[scenario];
  const divisor = 2 * (4 / vcpus);
  const tasksPerRegion = numUsers / divisor;
  if (!Number.isInteger(tasksPerRegion)) {
    console.error(
      `Invalid numUsers (${numUsers}): must be divisible by ${divisor}`
    );
    process.exit(3);
  }
  await startClients(tasksPerRegion, url, vcpus, "us-west-1", isGdocs);
  await startClients(tasksPerRegion, url, vcpus, "eu-north-1", isGdocs);

  // Now we run until the server exits or we time out.
  setTimeout(() => {
    if (!experimentStarted) {
      console.error(
        "Error: Experiment failed to start within timeout, exiting."
      );
      process.exit(7);
    }
  }, expStartTimeoutMS);
})();

async function getPublicDns(): Promise<string> {
  // Assuming we're running on AWS EC2, get our public DNS address.
  // See https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
  const response = await fetch(
    "http://169.254.169.254/latest/meta-data/public-hostname"
  );
  return await response.text();
}

async function startClients(
  numTasks: number,
  url: string,
  vcpus: 1 | 0.5,
  region: "us-west-1" | "eu-north-1",
  isGdocs: boolean
) {
  // Command to start a number of tasks (appended to the end).
  const command = clientCommands[vcpus][region];

  let tasksRemaining = numTasks;
  // For gdocs, start at most one client per second, to avoid http 429 errors.
  let backoff = isGdocs ? 4 / vcpus : 1;
  while (tasksRemaining > 0) {
    const attempt = Math.min(tasksRemaining, isGdocs ? 1 : 10);
    console.log(`Start ${attempt}/${tasksRemaining} tasks in ${region}...`);
    const output = await new Promise<string>((resolve) => {
      child_process.exec(
        command + attempt,
        {
          env: { ...process.env, URL: url },
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              "Error spawning AWS cli command (is the CLI installed and configured?):",
              error
            );
            process.exit(4);
          }
          if (stderr !== "") {
            console.error("AWS CLI error output (is the CLI configured?):");
            console.error(stderr);
            process.exit(5);
          }
          resolve(stdout);
        }
      );
    });
    let hadFailures = false;
    try {
      const failures = JSON.parse(output).failures.length;
      hadFailures = failures !== 0;
      console.log(`\t${failures} failures`);
      tasksRemaining -= attempt - failures;
    } catch (err) {
      // JSON parsing error.
      console.error(
        'Failed to parsed output (does the AWS CLI config need "output = json"?)'
      );
    }

    if (tasksRemaining !== 0) {
      if (backoff > 300) {
        console.log("Too many Fargate Spot failures in a row, giving up.");
        process.exit(6);
      }
      if (backoff > 30) {
        console.log("Warning: large backoff:", backoff, "seconds");
      }
      await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
      if (hadFailures) backoff *= 2;
    }
  }
}

const clientCommands = {
  [0.5]: {
    "us-west-1": `aws ecs run-task --no-cli-pager --region us-west-1 \\
--cluster collabs-nsdi-clients \\
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \\
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0d97c34e5713def63", "subnet-0724fa536688bfc1c"], "assignPublicIp": "ENABLED"}}' \\
--overrides "{\\"containerOverrides\\": [{\\"name\\": \\"client0\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client1\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client2\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client3\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client4\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client5\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client6\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client7\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}]}" \\
--task-definition collabs-nsdi-client-half-x8:1 \\
--count `,
    "eu-north-1": `aws ecs run-task --no-cli-pager --region eu-north-1 \\
--cluster collabs-nsdi-clients \\
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \\
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0ad3f0086a76e2048", "subnet-0d018ebca70386512", "subnet-02f85f5ba0e866b57"], "assignPublicIp": "ENABLED"}}' \\
--overrides "{\\"containerOverrides\\": [{\\"name\\": \\"client0\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client1\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client2\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client3\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client4\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client5\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client6\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client7\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}]}" \\
--task-definition collabs-nsdi-client-half-x8:1 \\
--count `,
  },
  [1.0]: {
    "us-west-1": `aws ecs run-task --no-cli-pager --region us-west-1 \\
--cluster collabs-nsdi-clients \\
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \\
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0d97c34e5713def63", "subnet-0724fa536688bfc1c"], "assignPublicIp": "ENABLED"}}' \\
--overrides "{\\"containerOverrides\\": [{\\"name\\": \\"client0\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client1\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client2\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client3\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}]}" \\
--task-definition collabs-nsdi-client-x4:1 \\
--count `,
    "eu-north-1": `aws ecs run-task --no-cli-pager --region eu-north-1 \\
--cluster collabs-nsdi-clients \\
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \\
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0ad3f0086a76e2048", "subnet-0d018ebca70386512", "subnet-02f85f5ba0e866b57"], "assignPublicIp": "ENABLED"}}' \\
--overrides "{\\"containerOverrides\\": [{\\"name\\": \\"client0\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client1\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client2\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}, {\\"name\\": \\"client3\\", \\"environment\\": [{\\"name\\": \\"URL\\", \\"value\\": \\"$URL\\"}]}]}" \\
--task-definition collabs-nsdi-client-x4:1 \\
--count `,
  },
};
