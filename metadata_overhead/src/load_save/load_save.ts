import { existsSync } from "fs";
import * as fsPromises from "fs/promises";
import {
  getInfoFromFileName,
  getSavedState,
  loadSaveCsvFields,
  logLoadSaveResult,
} from "../util";
import { AutomergeDoc } from "./automerge";
import { CollabsDoc } from "./collabs";
import { Doc } from "./doc";
import { YjsDoc } from "./yjs";

(async function () {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Wrong number of args");
    console.log("Usage: npm run loadSave <output file> <input files...>");
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
      [...Object.values(loadSaveCsvFields)].join(",")
    );
  }

  const inputFiles = args.slice(1);
  for (const savedStateFile of inputFiles) {
    console.log(savedStateFile);
    const { framework } = getInfoFromFileName(savedStateFile);

    let DocClass: new () => Doc;
    switch (framework) {
      case "yjs":
        DocClass = YjsDoc;
        break;
      case "automerge":
      case "automergeCustom":
      case "automergeRepo":
        DocClass = AutomergeDoc;
        break;
      case "collabs":
      case "collabsNoVC":
        DocClass = CollabsDoc;
        break;
      default:
        console.log("Unrecognized framework, skipping:", framework);
        continue;
    }

    await analyzeLoadAndSaveTime(outputFile, savedStateFile, DocClass);
  }
})();

const REAL_ITER = 10;
const WARMUP_ITER = 5;
const SLEEP_MS = 200;

async function analyzeLoadAndSaveTime(
  outputFile: string,
  savedStateFile: string,
  DocClass: new () => Doc
) {
  const savedBytes = await getSavedState(savedStateFile);
  const loadTimes = [];
  const saveTimes = [];

  for (let i = -WARMUP_ITER; i < REAL_ITER; i++) {
    // Sleep between trials. Necessary to prevent spike in Automerge load
    // times during later trials.
    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));

    // Load time
    const loadStartTime = process.hrtime.bigint();

    const doc = new DocClass();
    doc.load(savedBytes);

    if (i >= 0) {
      loadTimes.push(
        new Number(process.hrtime.bigint() - loadStartTime).valueOf()
      );
    }

    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));

    // Save time
    const saveStartTime = process.hrtime.bigint();

    const binary = doc.save();

    if (i >= 0) {
      saveTimes.push(
        new Number(process.hrtime.bigint() - saveStartTime).valueOf()
      );
    }
  }

  // Measure ratio of savedBytes size to Quill JSON size.
  const doc = new DocClass();
  doc.load(savedBytes);
  const quillState = JSON.stringify(doc.toQuill());

  await logLoadSaveResult(
    outputFile,
    savedStateFile,
    loadTimes,
    saveTimes,
    savedBytes.byteLength,
    quillState.length
  );
}
