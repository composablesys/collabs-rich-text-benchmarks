import { next as Automerge } from "@automerge/automerge";
import * as stats from "simple-statistics";
import { getSavedState } from "./util";

// Usage: npm run automergeMark <insert|delete|mark> [savedState file]
// Benchmarks the time to call applyChanges on an op of the given type.
// If a savedState file is provided (e.g. allActive-96-automerge.savedState),
// it benchmarks (applies updates to) that state.
// Otherwise, it benchmarks the simulated doc described in the paper.

const WARMUP_ITERS = 5;
const TRIAL_ITERS = 10;

const OP_TYPES = ["insert", "delete", "mark"] as const;

(async function () {
  let doc: Automerge.Doc<{ text: string }>;

  const args = process.argv.slice(2);
  const opType = args[0] as typeof OP_TYPES[number];
  if (!OP_TYPES.includes(opType)) {
    console.log(
      `Invalid opType (first arg): ${opType}, must be one of ${OP_TYPES}`
    );
    return;
  }

  if (args.length === 2) {
    const savedState = await getSavedState(args[1]);
    doc = Automerge.load(savedState);
  } else {
    // Prepare the simulated doc described in the paper.
    doc = Automerge.from({ text: "" });
    doc = Automerge.change(doc, (doc) => {
      Automerge.splice(
        doc,
        ["text"],
        0,
        0,
        new Array(52500).fill("a").join("")
      );
      for (let i = 0; i < 900; i++) {
        Automerge.mark(
          doc,
          ["text"],
          { start: i * 55, end: i * 55 + 20, expand: "after" },
          "bold",
          i % 2 === 0
        );
      }
    });
  }

  const toLoad = Automerge.save(doc);

  console.log("Text length:", doc.text.length);
  console.log("Marks count:", Automerge.marks(doc, ["text"]).length);
  console.log("Automerge saved state size (KiB):", toLoad.byteLength / 1024);
  console.log("Automerge op count:", getOpSetSize(doc));

  const updates: Uint8Array[] = [];
  for (let i = -WARMUP_ITERS; i < TRIAL_ITERS; i++) {
    doc = Automerge.change(doc, (doc) => {
      const start = Math.max(0, doc.text.length - 1000 + 10 * i);
      switch (opType) {
        case "insert":
          Automerge.splice(doc, ["text"], start, 0, "b");
          break;
        case "delete":
          Automerge.splice(doc, ["text"], start, 1);
          break;
        case "mark":
          Automerge.mark(
            doc,
            ["text"],
            {
              start,
              end: start + 10,
              expand: "none",
            },
            "markKey",
            i
          );
          break;
      }
    });
    updates.push(Automerge.getLastLocalChange(doc)!);
  }

  // Time applying each update with a patchCallback.
  let doc2 = Automerge.load<{ text: string }>(toLoad);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  let i = -WARMUP_ITERS;
  const timesMS: number[] = [];
  for (const update of updates) {
    const startTime = process.hrtime.bigint();
    doc2 = Automerge.applyChanges(doc2, [update], {
      patchCallback: () => {},
    })[0];
    const endTime = process.hrtime.bigint();
    if (i >= 0) {
      timesMS.push(new Number(endTime - startTime).valueOf() / 1000000);
    }
    i++;
  }

  console.log(
    "Time per op (ms):",
    stats.average(timesMS),
    "+/-",
    stats.sampleStandardDeviation(timesMS)
  );
})();

/**
 * Returns the number of ops in Automerge's internal OpSet.
 */
function getOpSetSize(doc: Automerge.Doc<any>) {
  // Automerge.dump appears to print the OpSet to the console,
  // one op per line. We hack console.log to count the number of lines.
  const realLog = console.log;
  let ops = 0;
  console.log = (data) => {
    ops++;
  };
  Automerge.dump(doc);
  console.log = realLog;
  return ops;
}
