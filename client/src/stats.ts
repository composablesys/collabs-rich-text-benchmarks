import * as child_process from "child_process";
import osu from "node-os-utils";
import os from "os";

// TODO: if update, also update other copy

const clockIntervalMS = 60 * 1000;

/**
 * Records CPU, memory, and network statistics for the process with the
 * given pid (but not its descendants) and the whole OS, every intervalSec seconds.
 *
 * If on AWS EC2 or Fargate, also records clock error bound every minute.
 *
 * @param includeLocal If true, process network stats include localhost traffic.
 * Use this for local testing (clients + server on same machine).
 * @returns An "off" function that stops stats measurements.
 */
export function startStats(
  pid: number,
  intervalSec: number,
  includeLocal: boolean,
  logger = console
): () => void {
  let offCalled = false;

  // CPU & memory (pid & system).
  const numCPUs = os.cpus().length;
  const top = child_process.spawn("top", [
    "-b",
    "-d",
    `${intervalSec}`,
    "-p",
    `${pid}`,
  ]);
  let first = true;
  top.stdout.on("data", (msg) => {
    if (first) {
      first = false;
      // Print out the whole text so we can check system totals & format.
      logger.log(
        JSON.stringify({
          type: "topRef",
          time: Date.now(),
          data: msg.toString(),
        })
      );
    }

    try {
      const lines = (<string>msg.toString()).trim().split("\n");
      // 3rd line: %Cpu(s). Find total usage by subtracting "idle" usage,
      // then scale by # cpus (so it's in units of 100/cpu).
      const idleCPU = Number.parseFloat(lines[2].split(",")[3].slice(0, -2));
      const osCPU = (numCPUs * (100 - idleCPU)).toFixed(1);
      // 4th line: MiB Mem. Extract used.
      const osMem = Number.parseFloat(lines[3].split(",")[2].slice(0, -4));
      // 5th line: MiB Swap. Extract used.
      const osSwap = Number.parseFloat(lines[4].split(",")[2].slice(0, -4));
      // Last line: process stats. Extract %CPU and RES.
      const procParts = lines[lines.length - 1].trim().split(/\s+/);
      // In units of 100/cpu.
      const procCPU = procParts[8];
      // In MiB, converted from the original KiB.
      const procMem = Math.round(Number.parseInt(procParts[5]) / 1024);

      logger.log(
        JSON.stringify({
          type: "top",
          time: Date.now(),
          osCPU,
          osMem,
          osSwap,
          procCPU,
          procMem,
        })
      );
    } catch (err) {
      // Not formatted how we expected; ignore.
    }
  });

  // Network (system).
  let netInterval: ReturnType<typeof setInterval>;
  if (process.env.ECS_CONTAINER_METADATA_URI_V4) {
    // We're running on AWS Fargate. See
    // https://docs.aws.amazon.com/AmazonECS/latest/userguide/task-metadata-endpoint-v4-fargate.html
    // (osu.netstats() doesn't work in this case.)
    // Note: these are per-task stats; divide by the number of containers per task.
    // (I could not find this documented, but in testing, it scales with the number
    // of containers per task.)
    netInterval = setInterval(async () => {
      const response = await fetch(
        `${process.env.ECS_CONTAINER_METADATA_URI_V4}/stats`
      );
      const output = await response.json();
      const networks = output.networks as Record<
        string,
        { rx_bytes: number; tx_bytes: number }
      >;
      logger.log(
        JSON.stringify({
          type: "net",
          time: Date.now(),
          // Format like osu.netstat's output.
          data: Object.entries(networks).map(([key, value]) => ({
            interface: key,
            inputBytes: value.rx_bytes,
            outputBytes: value.tx_bytes,
          })),
        })
      );
    }, intervalSec * 1000);
  } else {
    // Note: When I run exps locally, only the server records these stats
    // successfully. It might be "locking" out the clients.
    netInterval = setInterval(() => {
      osu.netstat.stats().then((data) =>
        logger.log(
          JSON.stringify({
            type: "net",
            time: Date.now(),
            data,
          })
        )
      );
    }, intervalSec * 1000);
  }

  // I tried using nethogs to measure network (pid), but it was unreliable
  // and does not work on Fargate.

  // Clock error bound.
  const clockInterval = setInterval(
    () => logClockErrorBound(logger, () => {}),
    clockIntervalMS
  );
  void logClockErrorBound(logger, () => clearInterval(clockInterval));

  const off = () => {
    offCalled = true;
    clearInterval(netInterval);
    clearInterval(clockInterval);
    if (top.exitCode === null) top.kill();
  };

  // Make sure we kill child processes on exit.
  process.on("exit", off);

  return off;
}

async function logClockErrorBound(logger: Console, toSkip: () => void) {
  if (process.env.ECS_CONTAINER_METADATA_URI_V4) {
    // We're running on AWS Fargate. See
    // https://docs.aws.amazon.com/AmazonECS/latest/userguide/task-metadata-endpoint-v4-fargate.html
    const response = await fetch(
      `${process.env.ECS_CONTAINER_METADATA_URI_V4}/task`
    );
    const output = await response.json();
    logger.log(
      JSON.stringify({
        type: "clock",
        time: Date.now(),
        clockErrorBoundMS: output.ClockDrift.ClockErrorBound,
      })
    );
  } else {
    // Use chronyc, which must be installed + enabled.
    // This should work on any Linux instance, but I'm targetting AWS EC2.
    // See https://aws.amazon.com/blogs/mt/manage-amazon-ec2-instance-clock-accuracy-using-amazon-time-sync-service-and-amazon-cloudwatch-part-2/
    const chronycProcess = child_process.spawn("chronyc", ["tracking"]);
    chronycProcess.on("error", () => {
      logger.log("chronyc not installed (?), skipping clockErrorBound stats");
      toSkip();
    });
    let output = "";
    chronycProcess.stdout.on("data", (data) => (output += data.toString()));
    chronycProcess.on("close", (code) => {
      if (code === 0) {
        // Process output.
        const lines = output.split("\n");
        const headers = ["System time", "Root delay", "Root dispersion"];
        const values = new Array<number | null>(headers.length).fill(null);
        for (const line of lines) {
          for (let i = 0; i < headers.length; i++) {
            if (line.startsWith(headers[i])) {
              const colon = line.indexOf(":") + 1;
              const spaceAfter = line.indexOf(" ", colon + 1);
              values[i] = Number.parseFloat(line.slice(colon, spaceAfter));
            }
          }
        }
        if (!values.includes(null)) {
          // Here we convert seconds to ms.
          const clockErrorBoundMS =
            (values[0]! + 0.5 * values[1]! + values[2]!) * 1000;
          logger.log(
            JSON.stringify({
              type: "clock",
              time: Date.now(),
              clockErrorBoundMS,
            })
          );
        }
      }
    });
  }
}
