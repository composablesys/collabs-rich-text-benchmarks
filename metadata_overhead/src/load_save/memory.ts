import { existsSync } from "fs";
import * as fsPromises from "fs/promises";
import {
  getInfoFromFileName,
  getSavedState,
  logMemoryResult,
  memoryCsvFields,
} from "../util";
import { AutomergeDoc } from "./automerge";
import { CollabsDoc } from "./collabs";
import { Doc } from "./doc";
import { YjsDoc } from "./yjs";

(async function () {
  const args = process.argv.slice(2);

  // Unlike loadSave, we don't accept multiple input files, to prevent
  // memory interference. Instead, use memory.sh (npm run memory).
  if (args.length !== 2) {
    console.error("Wrong number of args");
    console.log("Usage: npm run memoryOne <output file> <input file>");
    console.log("where:");
    console.log(
      "- Output file is the csv file to append output to (creating if needed)"
    );
    console.log(
      "- Each input file contains the saved states after running a framework (extension .savedState)"
    );
    process.exit(1);
  }

  const outputFile = args[0];
  if (!existsSync(outputFile)) {
    await fsPromises.writeFile(
      outputFile,
      // CSV header.
      [...Object.values(memoryCsvFields)].join(",")
    );
  }

  const savedStateFile = args[1];
  const { framework } = getInfoFromFileName(savedStateFile);

  let DocClass: new () => Doc;
  let wasm = false;
  switch (framework) {
    case "yjs":
      DocClass = YjsDoc;
      break;
    case "automerge":
    case "automergeCustom":
    case "automergeRepo":
      DocClass = AutomergeDoc;
      wasm = true;
      break;
    case "collabs":
    case "collabsNoVC":
      DocClass = CollabsDoc;
      break;
    default:
      console.log("Unrecognized framework, skipping:", framework);
      return;
  }

  const savedBytes = await getSavedState(savedStateFile);
  const memUseds = wasm
    ? await analyzeWasmMemory(savedBytes, DocClass)
    : await analyzeHeapMemory(savedBytes, DocClass);
  await logMemoryResult(outputFile, savedStateFile, memUseds);
})();

const REAL_ITER = 10;
const WARMUP_ITER = 5;
const SLEEP_MS = 200;

async function analyzeWasmMemory(
  savedBytes: Uint8Array,
  DocClass: new () => Doc
) {
  const memUseds: number[] = [];

  // To prevent 0s from WASM reusing old memory, keep old docs around.
  const oldDocs: Doc[] = [];

  for (let i = -WARMUP_ITER; i < REAL_ITER; i++) {
    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));

    // For WASM, measure resident set size.
    const memStart = process.memoryUsage().rss;

    const doc = new DocClass();
    doc.load(savedBytes);

    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
    if (i >= 0) memUseds.push(process.memoryUsage().rss - memStart);

    oldDocs.push(doc);
  }

  return memUseds;
}

async function analyzeHeapMemory(
  savedBytes: Uint8Array,
  DocClass: new () => Doc
) {
  const memUseds: number[] = [];

  for (let i = -WARMUP_ITER; i < REAL_ITER; i++) {
    // To prevent old docs hanging around for an extra trial and potentially
    // getting GC'd in the middle, scope them in a separate function.
    // This appears to work more reliably than just using the loop scope.
    const memUsed = await heapOneTrial(savedBytes, DocClass);
    if (i >= 0) memUseds.push(memUsed);
  }

  return memUseds;
}

async function heapOneTrial(savedBytes: Uint8Array, DocClass: new () => Doc) {
  // Do our best to force GC.
  await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  global.gc!();
  await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  // Measure JS heap used.
  const memStart = process.memoryUsage().heapUsed;

  const doc = new DocClass();
  doc.load(savedBytes);

  // Do our best to force GC again.
  await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  global.gc!();
  await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  return process.memoryUsage().heapUsed - memStart;
}
