import { toByteArray } from "base64-js";
import * as fsPromises from "fs/promises";
import path from "path";
import * as stats from "simple-statistics";

// This function takes in an analyzed output directory and gets the
// saved state file
export const getSavedState = async (
  savedStateFile: string
): Promise<Uint8Array> => {
  let savedState = await fsPromises.readFile(savedStateFile, "utf-8");
  savedState = savedState.slice(1, -1); // rip off the beginning and ending quote
  const savedBytes = toByteArray(savedState);

  return savedBytes;
};

// This function compares two byte arrays and check if they are identical
// It throws an error if they are different.
export const check_byte_arrays = (arr1: Uint8Array, arr2: Uint8Array) => {
  if (arr1.length != arr2.length) {
    throw new Error(
      "State changed during load and saved: different byte array size" +
        arr1.length +
        " " +
        arr2.length
    );
  }
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] != arr2[i]) {
      throw new Error(
        "State changed during load and saved: different byte at index " + i
      );
    }
  }
};

// This function takes in a filename and returns the framework name
// e.g. It would extract "automerge" from "analysis/output/profiles/allActive-16-automerge-0.savedstate"
export const getInfoFromFileName = (filename: string) => {
  filename = path.basename(filename);
  const dotIndex = filename.lastIndexOf(".");
  const parts = filename.slice(0, dotIndex).split("-");
  return { scenario: parts[0], numUsers: parts[1], framework: parts[2] };
};

export const loadSaveCsvFields = [
  "Scenario",
  "# Users",
  "Framework",
  "Load Time (ms)",
  "Load Time StdDev (ms)",
  "Save Time (ms)",
  "Save Time StdDev (ms)",
  // Framework / Quill
  "Saved State Size Ratio",
  "Saved State Size (KiB)",
  "Quill State Size (KiB)",
];

// This function exports the mean and std dev of load-and-save times to outputFile.
export const logLoadSaveResult = async (
  outputFile: string,
  savedStateFile: string,
  /** In ns. */
  loadTimes: number[],
  /** In ns. */
  saveTimes: number[],
  /** In bytes. */
  savedStateSize: number,
  /** In bytes (really JSON chars). */
  quillSize: number
) => {
  const info = getInfoFromFileName(savedStateFile);
  const csvRow = [
    info.scenario,
    info.numUsers,
    info.framework,
    stats.average(loadTimes) / 1000000,
    stats.sampleStandardDeviation(loadTimes) / 1000000,
    stats.average(saveTimes) / 1000000,
    stats.sampleStandardDeviation(saveTimes) / 1000000,
    savedStateSize / quillSize,
    savedStateSize / 1024,
    quillSize / 1024,
  ];
  await fsPromises.appendFile(outputFile, "\n" + csvRow.join(","));
};

export const memoryCsvFields = [
  "Scenario",
  "# Users",
  "Framework",
  "Memory Used (MiB)",
  "Memory Used StdDev (MiB)",
];

// This function exports the mean and std dev of memory used values to outputFile.
export const logMemoryResult = async (
  outputFile: string,
  savedStateFile: string,
  /* In bytes. */
  memUseds: number[]
) => {
  const info = getInfoFromFileName(savedStateFile);
  const csvRow = [
    info.scenario,
    info.numUsers,
    info.framework,
    stats.average(memUseds) / (1024 * 1024),
    stats.sampleStandardDeviation(memUseds) / (1024 * 1024),
  ];
  await fsPromises.appendFile(outputFile, "\n" + csvRow.join(","));
};
