import * as stats from "simple-statistics";
import * as Y from "yjs";
import { getSavedState } from "./util";

// Usage: npm run yjs [savedState file]
// Benchmarks the time to call `get delta()` on a transaction's Y.TextEvent.
// If a savedState file is provided (e.g. allActive-96-yjs.savedState),
// it benchmarks (applyies updates to) that state.
// Otherwise, it benchmarks the simulated doc described in the paper.

const WARMUP_ITERS = 5;
const TRIAL_ITERS = 10;

(async function () {
  const doc = new Y.Doc();
  const text = doc.getText("quill");

  const args = process.argv.slice(2);
  if (args.length === 1) {
    const savedState = await getSavedState(args[0]);
    Y.applyUpdate(doc, savedState);
  } else {
    // Prepare the simulated doc described in the paper.
    for (let i = 0; i < 16500; i++) {
      const attrs: Record<string, any> = {};
      if (i % 2 === 0) attrs["bold"] = true;
      text.insert(i, "a", attrs);
    }
  }

  const toLoad = Y.encodeStateAsUpdate(doc);

  console.log(
    "Quill state size (KiB):",
    JSON.stringify(text.toDelta()).length / 1024
  );
  console.log("Yjs saved state size (KiB):", toLoad.byteLength / 1024);
  console.log("Yjs item count:", getItemSize(text));

  const updates: Uint8Array[] = [];
  doc.on("update", (update) => updates.push(update));
  for (let i = -WARMUP_ITERS; i < TRIAL_ITERS; i++) {
    doc.transact(
      () =>
        // Use applyDelta like y-quill does.
        text.applyDelta([{ retain: 10 * i }, { insert: "a", attributes: {} }]),
      doc
    );
  }

  // Time getting the delta for each update.
  const doc2 = new Y.Doc();
  Y.applyUpdate(doc2, toLoad);
  const text2 = doc2.getText("quill");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  let i = -WARMUP_ITERS;
  const timesMS: number[] = [];
  text2.observe((e) => {
    const startTime = process.hrtime.bigint();
    void e.delta;
    const endTime = process.hrtime.bigint();
    if (i >= 0) {
      timesMS.push(new Number(endTime - startTime).valueOf() / 1000000);
    }
    i++;
  });

  for (const update of updates) Y.applyUpdate(doc2, update);
  console.log(
    "get delta() time per op (ms):",
    stats.average(timesMS),
    "+/-",
    stats.sampleStandardDeviation(timesMS)
  );
})();

/**
 * Returns the number of items in Yjs's internal linked list.
 */
function getItemSize(type: Y.AbstractType<any>) {
  let ans = 0;
  let item = type._start;
  while (item !== null) {
    ans++;
    item = item.right;
  }
  return ans;
}
