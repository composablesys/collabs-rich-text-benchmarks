import * as math from "mathjs";

export interface ExpInfo {
  scenario: string;
  numUsers: number;
  framework: string;
  includeLocal: boolean;
  senderBatch: boolean;
}

export function infoEqual(a: ExpInfo, b: ExpInfo): boolean {
  return (
    a.scenario === b.scenario &&
    a.numUsers === b.numUsers &&
    a.framework === b.framework
  );
}

export class PerfData {
  /** In units of 100/cpu. */
  readonly cpu: number[] = [];
  /** In MiB. */
  readonly mem: number[] = [];
  /** In KiB/sec. */
  readonly netSent: number[] = [];
  /** In KiB/sec. */
  readonly netReceived: number[] = [];

  cells(): [
    cpu: number | undefined,
    mem: number | undefined,
    net: number | undefined
  ] {
    const sent = safeMean(this.netSent);
    const received = safeMean(this.netReceived);
    return [
      safeMean(this.cpu),
      safeMean(this.mem),
      sent === undefined || received === undefined
        ? undefined
        : sent + received,
    ];
  }
}

function safeMean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  else return math.mean(values);
}

export interface ProfileData {
  type: "profile";
  highFreq: boolean;
  profile: object;
}

export interface SavedSizeData {
  type: "savedSize";
  /** The framework's saved state size, in bytes. */
  savedSize: number;
  /** The doc length (in chars). */
  length: number;
  /** The Quill saved state's size (in chars). */
  quillSaveSize: number;
  /** The saved state (in chars). */
  savedState: string;
}

export interface BucketData {
  /**
   * Latencies for all sigils that started within a given bucket,
   * aggregated across all receivers and trials.
   */
  localLats: number[];
  remoteLats: number[];
  /**
   * The number of sigils *sent* in this bucket, i.e.,
   * the offered throughput (relative to intended throughput
   * of one sigil per (user * bucket * trial).)
   */
  throughput: number;
  /**
   * The total count of receipts for sigils sent in this bucket.
   * Ideal is (througput * numUsers).
   */
  successes: number;
  /**
   * The doc lengths (in chars) output during this bucket.
   */
  docLengths: number[];
  /**
   * The doc Quill-op counts output during this bucket.
   */
  quillOps: number[];
  /**
   * The lengths (in ms) of long tasks output during this bucket.
   *
   * Compare their sum to the total wall-clock time (10 sec * users * trials).
   */
  longTasks: number[];
  /** Perf data output during the bucket. */
  serverOS: PerfData;
  serverProc: PerfData;
  clientOS: PerfData;
  clientProc: PerfData;
}

export const commonCsvFields = {
  throughput: "Throughput (% offered)",
  localP50: "Local Latency P50 (ms)",
  localP95: "Local Latency P95 (ms)",
  localP99: "Local Latency P99 (ms)",
  // The percentage of local latencies that are <150 ms.
  localSub150: "Local Latencies <150 ms (%)",
  remoteP50: "Remote Latency P50 (ms)",
  remoteP95: "Remote Latency P95 (ms)",
  remoteP99: "Remote Latency P99 (ms)",
  remoteSub2500: "Remote Latencies <2.5 sec (%)",
  // The fraction of wall-clock time spent in tasks above a given length.
  longTask50: "Time in 50+ ms Tasks (%)",
  longTask100: "Time in 100+ ms Tasks (%)",
  longTask200: "Time in 200+ ms Tasks (%)",
  clientCpu: "Client CPU (%)",
  clientMem: "Client Mem (MiB)",
  clientNet: "Client Net (KiB/sec)",
  serverCpu: "Server CPU (%)",
  serverMem: "Server Mem (MiB)",
  serverNet: "Server Net (KiB/sec)",
  // For cross-checking
  successes: "Sigil Success (%)",
  clientOsCpu: "Client OS CPU (%)",
  clientOsMem: "Client OS Mem (MiB)",
  clientOsNet: "Client OS Net (KiB/sec)",
  serverOsCpu: "Server OS CPU (%)",
  serverOsMem: "Server OS Mem (MiB)",
  serverOsNet: "Server OS Net (KiB/sec)",
} as const;

export const seriesCsvFields = {
  time: "Time (sec)",
  ...commonCsvFields,
  // Doc size stats.
  docLength: "Text Length (KiB)",
  quillOps: "Quill Ops (Ki)",
} as const;

export const summaryCsvFields = {
  scenario: "Scenario",
  numUsers: "# Users",
  framework: "Framework",
  senderBatch: "Sender-Side Batching",
  // The number of users that were actually active (managed to receive
  // one of their own sigils).
  // Max across all trials.
  activeUsers: "Active Users - Max Observed",
  ...commonCsvFields,
  // Framework's doc's saved state size at the end of the trial,
  // measured at the same time as endDocLength and endQuillSaveSize.
  endSavedSize: "Saved State Size (KiB) - End",
  endDocLength: "Text Length (KiB) - End",
  endQuillSaveSize: "Quill State Size (KiB) - End",
  maxClockErrorBound: "Clock Error Bound (ms)",
};

export type CommonCsvData = Partial<
  Record<keyof typeof commonCsvFields, number>
>;

export type SeriesCsvData = Partial<
  Record<keyof typeof seriesCsvFields, number>
>;

export type SummaryCsvData = {
  scenario: string;
  numUsers: number;
  framework: string;
  senderBatch: boolean;
  activeUsers: number;
  endSavedSize: number | undefined;
  endDocLength: number | undefined;
  endQuillSaveSize: number | undefined;
  maxClockErrorBound: number | undefined;
} & CommonCsvData;
