import { existsSync } from "fs";
import * as fsPromises from "fs/promises";
import { mean } from "mathjs";
import path from "path";
import {
  BUCKET_LENGTH,
  SIGIL_RECEIVE_NO,
  SIGIL_RECEIVE_STEP,
  TOTAL_BUCKETS,
  TRIAL_BUCKETS,
} from "./constants";
import {
  BucketData,
  ExpInfo,
  PerfData,
  ProfileData,
  SavedSizeData,
  SeriesCsvData,
  SummaryCsvData,
  infoEqual,
  seriesCsvFields,
  summaryCsvFields,
} from "./types";
import {
  SigilStore,
  csvRow,
  eachLine,
  getBucketIndex,
  longTaskFractions,
  meanTimeSeries,
  parseTime,
  percentSub,
  percentiles,
} from "./util";

/**
 * Each trial consists of:
 * - 1 minute warmup
 * - 5 minutes measured
 * - 1 extra bucket for receiving sigils sent in the last measured bucket
 * for a total of 6:10 minutes.
 *
 * Latency measurements for all sigils *sent* within a bucket are aggregated
 * across all clients and trials, then we compute percentiles.
 *
 * Perf measurements recorded within a bucket are averaged across all clients
 * and trials, and for the server across all trials.
 *
 * We also output stats averaged/maxed across the buckets.
 */
export async function analyzeOneExperiment(
  outputDir: string,
  inputDir: string
) {
  await fsPromises.mkdir(outputDir, { recursive: true });
  const profileFolder = path.join(outputDir, "profiles");
  await fsPromises.mkdir(profileFolder, { recursive: true });
  const savedStateFolder = path.join(outputDir, "savedStates");
  await fsPromises.mkdir(savedStateFolder, { recursive: true });

  const trialFolders = (
    await fsPromises.readdir(inputDir, { withFileTypes: true })
  )
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(inputDir, dirent.name));
  if (trialFolders.length === 0) {
    throw new Error("No trial folders");
  }
  const numTrials = trialFolders.length;
  console.log(`Found ${numTrials} trials`);

  const buckets = new Array<BucketData>(TOTAL_BUCKETS);
  for (let i = 0; i < buckets.length; i++) {
    buckets[i] = {
      localLats: [],
      remoteLats: [],
      throughput: 0,
      successes: 0,
      docLengths: [],
      quillOps: [],
      longTasks: [],
      serverOS: new PerfData(),
      serverProc: new PerfData(),
      clientOS: new PerfData(),
      clientProc: new PerfData(),
    };
  }

  const savedSizeDatas: SavedSizeData[] = [];
  /** undefined if any file lacked a clockErrorBound measurement. */
  let maxClockErrorBound: number | undefined = -1;
  const activeUsersPerTrial: number[] = [];

  let info: ExpInfo | null = null;
  let infoPrefix!: string;
  let trial = 0;
  for (const trialFolder of trialFolders) {
    const logFiles = (
      await fsPromises.readdir(trialFolder, { withFileTypes: true })
    )
      .filter((dirent) => dirent.isFile())
      .map((dirent) => path.join(trialFolder, dirent.name));

    if (info === null) {
      info = (await getInfo(logFiles[0]))[0];
      infoPrefix = `${info.scenario}-${info.numUsers}-${info.framework}`;
    }

    if (logFiles.length !== info.numUsers + 1) {
      throw new Error(
        `Wrong number of files: found ${logFiles.length}, should be ${
          info.numUsers + 1
        } (trial ${trialFolder})`
      );
    }

    // 1. Find the server file, and check that all info fields agree.
    let serverFile: string | null = null;
    for (const logFile of logFiles) {
      const [logInfo, logType] = await getInfo(logFile);
      if (logType === "server") {
        if (serverFile !== null) {
          throw new Error(
            "Two server files found in trial: " + serverFile + " , " + logFile
          );
        }
        serverFile = logFile;
        // Check the remaining files to make sure there is not a
        // duplicate server.
        // This is not too expensive because getType only reads the beginning
        // of each file.
      }
      if (!infoEqual(info, logInfo)) {
        throw new Error(
          `Info fields disagree: ${JSON.stringify(info)}, ${JSON.stringify(
            logInfo
          )}`
        );
      }
    }
    if (serverFile === null) {
      throw new Error("No server file found in trial " + trialFolder);
    }

    // The start time for measurements.
    const startTime = await getStartTime(serverFile);

    // 2. Process all files (client + server).
    const sigilStore = new SigilStore();
    for (const logFile of logFiles) {
      if (logFile !== serverFile) {
        const profileOrSavedSize = await processSigilsAndProfile(
          logFile,
          sigilStore
        );
        if (profileOrSavedSize !== null) {
          switch (profileOrSavedSize.type) {
            case "profile":
              const suffix = profileOrSavedSize.highFreq ? "-highFreq" : "";
              await fsPromises.writeFile(
                path.join(
                  profileFolder,
                  `${infoPrefix}-${trial}${suffix}.cpuprofile`
                ),
                JSON.stringify(profileOrSavedSize.profile)
              );
              break;
            case "savedSize":
              savedSizeDatas.push(profileOrSavedSize);
              await fsPromises.writeFile(
                path.join(
                  savedStateFolder,
                  `${infoPrefix}-${trial}.savedstate`
                ),
                JSON.stringify(profileOrSavedSize.savedState)
              );
              break;
          }
        }
      }
      const fileClockErrorBound = await processPerf(
        logFile,
        startTime,
        info.includeLocal,
        logFile === serverFile ? "server" : "client",
        buckets
      );
      if (fileClockErrorBound === undefined) maxClockErrorBound = undefined;
      else if (maxClockErrorBound !== undefined) {
        maxClockErrorBound = Math.max(maxClockErrorBound, fileClockErrorBound);
      }
    }

    const activeUsers = sigilStore.process(startTime, buckets);
    activeUsersPerTrial.push(activeUsers);
    trial++;
  }

  if (info === null) throw new Error("info not set");

  // Output time-series data.
  // Start with CSV header.
  const timeSeriesLines = [[...Object.values(seriesCsvFields)].join(",")];
  const trialPeriodDatas: SeriesCsvData[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    const data: SeriesCsvData = {};

    data.time = (i * BUCKET_LENGTH) / 1000;
    if (bucket.docLengths.length !== 0) {
      data.docLength = mean(bucket.docLengths) / 1024;
    }
    if (bucket.quillOps.length !== 0) {
      data.quillOps = mean(bucket.quillOps) / 1024;
    }
    data.throughput = (100 * bucket.throughput) / (info.numUsers * numTrials);
    [data.localP50, data.localP95, data.localP99] = percentiles(
      bucket.localLats
    );
    data.localSub150 = percentSub(bucket.localLats, 150);
    [data.remoteP50, data.remoteP95, data.remoteP99] = percentiles(
      bucket.remoteLats
    );
    data.remoteSub2500 = percentSub(bucket.remoteLats, 2500);
    [data.longTask50, data.longTask100, data.longTask200] = longTaskFractions(
      bucket.longTasks,
      BUCKET_LENGTH * info.numUsers * numTrials,
      [50, 100, 200]
    );
    [data.clientCpu, data.clientMem, data.clientNet] =
      bucket.clientProc.cells();
    [data.serverCpu, data.serverMem, data.serverNet] =
      bucket.serverProc.cells();

    data.successes =
      (100 * bucket.successes) / (info.numUsers * bucket.throughput);
    [data.clientOsCpu, data.clientOsMem, data.clientOsNet] =
      bucket.clientOS.cells();
    [data.serverOsCpu, data.serverOsMem, data.serverOsNet] =
      bucket.serverOS.cells();

    timeSeriesLines.push(csvRow(seriesCsvFields, data));
    // Only include the last TRIAL_BUCKETS in the trialPeriodDatas, used for
    // the summary row.
    if (i >= buckets.length - TRIAL_BUCKETS) trialPeriodDatas.push(data);
  }
  await fsPromises.writeFile(
    path.join(outputDir, `${infoPrefix}.csv`),
    timeSeriesLines.join("\n")
  );

  // Append summary data to summary.csv.
  const summaryFile = path.join(outputDir, "summary.csv");
  if (!existsSync(summaryFile)) {
    await fsPromises.writeFile(
      summaryFile,
      // CSV header.
      [...Object.values(summaryCsvFields)].join(",")
    );
  }
  const summaryData: SummaryCsvData = {
    scenario: info.scenario,
    numUsers: info.numUsers,
    framework: info.framework,
    senderBatch: info.senderBatch,
    activeUsers: Math.max(...activeUsersPerTrial),
    ...meanTimeSeries(trialPeriodDatas),
    endSavedSize: safeMeanKiB(savedSizeDatas.map((data) => data.savedSize)),
    endDocLength: safeMeanKiB(savedSizeDatas.map((data) => data.length)),
    endQuillSaveSize: safeMeanKiB(
      savedSizeDatas.map((data) => data.quillSaveSize)
    ),
    // This will only be present if we get a measurement from every file.
    maxClockErrorBound,
  };
  await fsPromises.appendFile(
    summaryFile,
    "\n" + csvRow(summaryCsvFields, summaryData)
  );
}

function safeMeanKiB(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  else return mean(values) / 1024;
}

async function getInfo(
  logFile: string
): Promise<[expInfo: ExpInfo, process: "server" | "client"]> {
  let ans: [expInfo: ExpInfo, process: "server" | "client"] | null = null;

  await eachLine(logFile, (line) => {
    if (line.startsWith("S:")) {
      throw new Error(
        "Error: sigil line before info line in " +
          logFile +
          "; this likely means old/extra clients were running before the experiment started."
      );
    }
    if (line.startsWith("{")) {
      const parsed = JSON.parse(line);
      if (parsed.type === "info") {
        ans = [
          {
            scenario: parsed.scenario,
            numUsers: parsed.numUsers,
            framework: parsed.framework,
            includeLocal: parsed.includeLocal,
            senderBatch: parsed.senderBatch ?? false,
          },
          parsed.process,
        ];
        return false;
      }
    }
  });

  if (ans === null) {
    throw new Error('No "type: info" message found in ' + logFile);
  }
  return ans;
}

async function getStartTime(serverFile: string): Promise<number> {
  let startTime = -1;
  await eachLine(serverFile, (line) => {
    if (line.startsWith("{")) {
      const parsed = JSON.parse(line);
      if (parsed.type === "start") {
        startTime = parsed.time;
        return false;
      }
    }
  });

  if (startTime === -1) {
    throw new Error("No start message found in server file " + serverFile);
  }
  return startTime;
}

async function processPerf(
  file: string,
  startTime: number,
  includeLocal: boolean,
  dest: "client" | "server",
  buckets: BucketData[]
): Promise<number | undefined> {
  let maxClockErrorBound = -1;

  let lastNetTime = -1;
  let lastNetSent = -1;
  let lastNetReceived = -1;

  await eachLine(file, (line) => {
    if (line.startsWith("{")) {
      const parsed = JSON.parse(line);

      if (parsed.time === undefined) return;
      const bucketIndex = getBucketIndex(parsed.time, startTime);
      if (bucketIndex === null) return;
      const bucket = buckets[bucketIndex];

      const osPerf = dest === "client" ? bucket.clientOS : bucket.serverOS;
      const procPerf =
        dest === "client" ? bucket.clientProc : bucket.serverProc;

      switch (parsed.type) {
        case "top": {
          osPerf.cpu.push(parsed.osCPU);
          osPerf.mem.push(parsed.osMem);
          // Also have parsed.osSwap available.
          procPerf.cpu.push(parsed.procCPU);
          procPerf.mem.push(parsed.procMem);
          break;
        }
        case "net": {
          if (parsed.data === "not supported") return;

          const netTime = parsed.time as number;
          let netSent = 0;
          let netReceived = 0;

          const data = parsed.data as {
            interface: string;
            inputBytes?: string;
            outputBytes?: string;
          }[];
          for (const row of data) {
            if (!includeLocal && row.interface.startsWith("lo")) continue;
            if (row.outputBytes === undefined || row.inputBytes === undefined)
              continue;
            netSent += Number.parseInt(row.outputBytes);
            netReceived += Number.parseInt(row.inputBytes);
          }

          if (lastNetTime !== -1) {
            const lenSec = (netTime - lastNetTime) / 1000;
            const sentKiB = (netSent - lastNetSent) / 1024;
            const receivedKiB = (netReceived - lastNetReceived) / 1024;
            osPerf.netSent.push(sentKiB / lenSec);
            osPerf.netReceived.push(receivedKiB / lenSec);
          }
          lastNetTime = netTime;
          lastNetSent = netSent;
          lastNetReceived = netReceived;
          break;
        }
        case "clock":
          maxClockErrorBound = Math.max(
            maxClockErrorBound,
            parsed.clockErrorBoundMS
          );
          break;
        case "app": {
          if (parsed.log.startsWith("{")) {
            const appParsed = JSON.parse(parsed.log);
            switch (appParsed.type) {
              case "size":
                bucket.docLengths.push(Number.parseInt(appParsed.length));
                if (appParsed.ops !== undefined) {
                  bucket.quillOps.push(Number.parseInt(appParsed.ops));
                }
                break;
              case "longtask":
                bucket.longTasks.push(...appParsed.taskLengths);
                break;
            }
          }
        }
      }
    }
  });

  return maxClockErrorBound === -1 ? undefined : maxClockErrorBound;
}

/**
 * @returns The JSON .cpuprofile contents if found, else null.
 */
async function processSigilsAndProfile(
  file: string,
  sigilStore: SigilStore
): Promise<ProfileData | SavedSizeData | null> {
  let ret: ProfileData | SavedSizeData | null = null;
  await eachLine(file, (line) => {
    if (line.startsWith("S:")) {
      // Sigil receive line.
      const [step, sigil, timeStr] = line.slice(2).split(",");
      if (!(step == SIGIL_RECEIVE_STEP || step === SIGIL_RECEIVE_NO)) return;
      const time = parseTime(timeStr, line);
      if (time === null) return;

      sigilStore.addReceive(file, sigil, time);
    } else if (line.startsWith("{")) {
      const parsed = JSON.parse(line);

      switch (parsed.type) {
        case "sigilSend":
          sigilStore.addSend(
            file,
            parsed.sigil as string,
            parsed.time as number
          );
          break;
        case "profile":
          ret = parsed as ProfileData;
          break;
        case "app":
          if (parsed.log.startsWith("{")) {
            const appParsed = JSON.parse(parsed.log);
            if (appParsed.type === "savedSize") {
              ret = appParsed as SavedSizeData;
            }
          }
          break;
      }
    }
  });

  return ret;
}
