import lineReader from "line-reader";
import { BUCKET_LENGTH, TOTAL_BUCKETS } from "./constants";
import { BucketData, CommonCsvData, commonCsvFields } from "./types";

/**
 * Version of lineReader.eachLine that returns a promise when done.
 */
export async function eachLine(
  file: string,
  cb: (line: string) => boolean | void
) {
  return new Promise<void>((resolve, reject) => {
    lineReader.eachLine(file, cb, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * The bucket that time falls in, or null if it is outside the
 * measured part of the trial.
 */
export function getBucketIndex(time: number, startTime: number): number | null {
  const bucket = Math.floor((time - startTime) / BUCKET_LENGTH);
  if (bucket < 0 || bucket >= TOTAL_BUCKETS) return null;
  return bucket;
}

export function parseTime(timeStr: string, line: string): number | null {
  const time = Number.parseInt(timeStr);
  if (isNaN(time)) {
    console.log('Bad time on line "' + line + '"');
    return null;
  }
  return time;
}

export function safeFloat(str: string, line: string): number {
  const ans = Number.parseFloat(str);
  if (isNaN(ans)) throw new Error('Bad float on line "' + line + '"');
  return ans;
}

export function csvRow<K extends string>(
  fields: Record<K, string>,
  data: Partial<Record<K, number | string | boolean>>
): string {
  const keys = [...Object.keys(fields)] as K[];
  return keys
    .map((key) => (data[key] === undefined ? "" : `${data[key]}`))
    .join(",");
}

export function meanTimeSeries(series: CommonCsvData[]): CommonCsvData {
  const ans: CommonCsvData = {};
  for (const keyStr of Object.keys(commonCsvFields)) {
    const key = keyStr as keyof typeof commonCsvFields;
    let sum = 0;
    let count = 0;
    for (const data of series) {
      if (data[key] !== undefined) {
        sum += data[key]!;
        count++;
      }
    }
    if (count === 0) ans[key] = undefined;
    else ans[key] = sum / count;
  }
  return ans;
}

/**
 * @returns Nearest-rank percentiles
 */
export function percentiles(
  values: number[]
): [p50: number | undefined, p95: number | undefined, p99: number | undefined] {
  if (values.length === 0) return [undefined, undefined, undefined];

  values.sort((a, b) => a - b);
  return [
    values[Math.ceil(values.length * 0.5) - 1],
    values[Math.ceil(values.length * 0.95) - 1],
    values[Math.ceil(values.length * 0.99) - 1],
  ];
}

/**
 * @returns The percentage of values that are less than threshold.
 */
export function percentSub(
  values: number[],
  threshold: number
): number | undefined {
  let sub = 0;
  for (const value of values) {
    if (value < threshold) sub++;
  }
  return 100 * (sub / values.length);
}

/**
 * For each threshold, returns the percentage of wallClockTime that was spent
 * in tasks with length >= that threshold.
 */
export function longTaskFractions(
  /** In ms */
  taskLengths: number[],
  /** In ms */
  wallClockTime: number,
  longTaskThresholds: number[]
): number[] {
  // Find the total time spent in tasks with length >= each threshold.
  const totals = new Array<number>(longTaskThresholds.length).fill(0);
  for (const taskLength of taskLengths) {
    for (let i = 0; i < longTaskThresholds.length; i++) {
      if (taskLength >= longTaskThresholds[i]) totals[i] += taskLength;
    }
  }
  return totals.map((total) => 100 * (total / wallClockTime));
}

interface SigilRaw {
  readonly sigil: string;
  sent?: number;
  sender?: string;
  readonly receives: Set<[file: string, time: number]>;
  readonly dedupedReceives: Map<string, number>;
}

/**
 * Stores and process all sigils for a single trial.
 */
export class SigilStore {
  private sigils = new Map<string, SigilRaw>();
  /** The sigils keyed by receiver, in the order they received them. */
  private receiverOrders = new Map<string, [raw: SigilRaw, time: number][]>();

  private getRaw(sigil: string): SigilRaw {
    let ans = this.sigils.get(sigil);
    if (ans === undefined) {
      ans = { sigil, receives: new Set(), dedupedReceives: new Map() };
      this.sigils.set(sigil, ans);
    }
    return ans;
  }

  addSend(file: string, sigil: string, time: number) {
    const raw = this.getRaw(sigil);
    if (raw.sender !== undefined) {
      throw new Error("Duplicate sigil send: " + sigil + " in file " + file);
    }
    raw.sender = file;
    raw.sent = time;
  }

  /**
   * Must be called in time order for each file.
   */
  addReceive(file: string, sigil: string, time: number) {
    const raw = this.getRaw(sigil);
    raw.receives.add([file, time]);

    let receiverOrder = this.receiverOrders.get(file);
    if (receiverOrder === undefined) {
      receiverOrder = [];
      this.receiverOrders.set(file, receiverOrder);
    }
    receiverOrder.push([raw, time]);
  }

  private filterNonsense() {
    // Because sigils are multiple characters, they can be messed up by
    // concurrent editing or batching. This shows up as spurious negative
    // or unusually-long latencies (when one sigil gets edited to look
    // like another). We filter these as well as we can.

    for (const [sigil, raw] of this.sigils) {
      // 1. Filter sigils with no send.
      if (raw.sender === undefined) {
        this.sigils.delete(sigil);
        continue;
      }
      // 2. Filter receives prior to the sigil's sending.
      for (const receive of raw.receives) {
        const time = receive[1];
        if (time < raw.sent!) raw.receives.delete(receive);
      }
      // 3. Filter all but the first receive of a sigil by a given user.
      for (const [file, time] of raw.receives) {
        if (!raw.dedupedReceives.has(file)) {
          raw.dedupedReceives.set(file, time);
        }
      }
    }

    // 4. Filter receives that violate PRAM consistency (out-of-order relative
    // to a single sender -> receiver channel).
    // Specifically, if the sender sent A < B, but the receiver saw B < A,
    // we drop the receiver's A: we assume that A was never received originally,
    // then a fake A showed up later.
    // In principle B could be the fake, but such a fake would have to be received
    // in the narrow interval [B sent, real B (or later sigil) received].
    for (const [receiver, receiverOrder] of this.receiverOrders) {
      /** Maps sender to the sent time for the last *valid* received sigil. */
      const lastFrom = new Map<string, number>();
      for (const [raw, time] of receiverOrder) {
        // Check that this receive is still valid.
        if (this.sigils.has(raw.sigil)) {
          if (raw.dedupedReceives.get(receiver) === time) {
            const lastTime = lastFrom.get(raw.sender!);
            if (lastTime !== undefined && raw.sent! < lastTime) {
              // A = raw was received after some previous B ~ lastTime, but the
              // sender sent A < B. Filter the receiver's A.
              raw.dedupedReceives.delete(receiver);
              // console.log((time - raw.sent!) / 1000);
            } else lastFrom.set(raw.sender!, raw.sent!);
          }
        }
      }
    }
  }

  /**
   * @returns The number of active users (users that saw at least one of their
   * own sigils).
   */
  process(startTime: number, buckets: BucketData[]): number {
    this.filterNonsense();

    const activeFiles = new Set();

    for (const raw of this.sigils.values()) {
      // Store the sigil's data in the bucket corresponding to when it was *sent*.
      const bucketIndex = getBucketIndex(raw.sent!, startTime);
      if (bucketIndex === null) continue;
      const bucket = buckets[bucketIndex];

      bucket.throughput++;

      for (const [file, time] of raw.dedupedReceives) {
        bucket.successes++;
        const lat = time - raw.sent!;
        if (file === raw.sender) {
          // Local receive.
          bucket.localLats.push(lat);
        } else {
          // Remote receive.
          bucket.remoteLats.push(lat);
        }
      }

      // If the sender received their own sigil, mark them as active.
      if (raw.dedupedReceives.has(raw.sender!)) activeFiles.add(raw.sender!);
    }

    return activeFiles.size;
  }
}
