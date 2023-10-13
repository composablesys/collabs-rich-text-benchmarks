/** Bucket size for line graphs, in ms. */
export const BUCKET_LENGTH = 10 * 1000;
/**
 * Length of the beginning warmup period, in ms.
 *
 * We still include this period in the over-time graphs.
 */
export const WARMUP_LENGTH = 5 * 60 * 1000;
/**
 * Length of the measured part of a trial, in ms.
 *
 * This is the part averaged in the summary graphs.
 */
export const TRIAL_LENGTH = 60 * 1000;

if (WARMUP_LENGTH % BUCKET_LENGTH !== 0) {
  throw new Error("BUCKET_SIZE must divide WARMUP_LENGTH");
}
if (TRIAL_LENGTH % BUCKET_LENGTH !== 0) {
  throw new Error("BUCKET_SIZE must divide TRIAL_LENGTH");
}
export const TOTAL_BUCKETS = (TRIAL_LENGTH + WARMUP_LENGTH) / BUCKET_LENGTH;
export const TRIAL_BUCKETS = TRIAL_LENGTH / BUCKET_LENGTH;

/**
 * The step at which we consider a sigil to be received:
 * - "a": During requestAnimationFrame, just before the sigil renders.
 * - "b": During a task scheduled during requestAnimationFrame,
 * sometime after the sigil renders (possibly long after).
 */
export const SIGIL_RECEIVE_STEP = "b";
/**
 * "Step" used in noQuill mode, which has only one option.
 */
export const SIGIL_RECEIVE_NO = "n";
