import { analyzeOneExperiment } from "./analyze_one";

(async function () {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Wrong number of args");
    console.log("Usage: npm start <output dir> <input dirs...>");
    console.log("where:");
    console.log(
      "- output dir is for all experiments; we append one line to " +
        "<output dir>/summary.csv, write time-series data to <exp info>.csv, " +
        "and write profiles to <output dir>/profiles/<exp info>-<trial#>.cpuprofile"
    );
    console.log(
      "- Each input dir contains the trial folders for one experiment, " +
        "and each trial folder contains a log file for each client + server"
    );
    process.exit(1);
  }

  const outputDir = args[0];
  let errored: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const inputDir = args[i];
    console.log("\nInput dir:", inputDir);
    try {
      await analyzeOneExperiment(outputDir, inputDir);
    } catch (err) {
      console.error(err);
      errored.push(inputDir);
    }
  }
  if (errored.length !== 0) {
    console.log("Encountered errors in:\n\t", errored.join("\n\t"));
  }
})();
