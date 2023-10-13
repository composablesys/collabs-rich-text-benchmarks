import { runBenchmark } from "./benchmark";

function printUsage(): never {
  console.log("Usage: npm start");
  console.log("The URL env variable must be set to the server's URL.");
  process.exit(1);
}

const url = process.env.URL;
if (url === undefined) {
  console.error("Error: URL env variable not set");
  printUsage();
}

runBenchmark(url);
