# Collabs Many-User Rich-Text Editing Benchmarks

Many-user rich-text editing benchmarks for [Collabs](https://collabs.readthedocs.io/en/latest/), [Yjs](https://docs.yjs.dev/), [Automerge](https://automerge.org/), [ShareDB](https://share.github.io/sharedb/), and Google Docs. As described in the Collabs paper's Section 7.1.

## Dependencies

- Linux
- Node v18+

See README.md in each folder for additional setup instructions. (Usually, you need to run `npm ci` to install dependencies.)

## Organization

- `server/`: Web server that serves each framework's rich-text editor and orchestrates the experiment.
- `client/`: Node.js program that uses [Puppeteer](https://pptr.dev/) to run a client, i.e., open the server's page in Chromium and simulate user activity. Also contains script to run a full experiment locally.
- `analysis/`: Analyzes the output of clients and the server to generates metrics for the paper.
- `aws/`: Helpers in case you choose to run the experiment clients on AWS ECS.
- `metadata_overhead/`: Microbenchmarks to measure metadata overhead, as described in the paper's Section 7.2.

## Data

- `analysis/charts/` contains LibreOffice Calc spreadsheets with the summary data used in the paper.
- Analysis script output (including CPU profiles and saved states - needed to run `metadata_overhead` benchmarks) and raw data can be downloaded separately from [https://cmu.box.com/s/ina8bc35c2wyu22q0tydfyaeb2c4744c](https://cmu.box.com/s/ina8bc35c2wyu22q0tydfyaeb2c4744c).

## Acknowledgments

Extensively modified from the [OWebSync paper's](https://doi.org/10.1109/TPDS.2021.3066276) eDesigners benchmark's code, provided by [Kristof Jannes](https://kristofjannes.com/).

Simulated user activity is based on Martin Kleppmann's [automerge-perf](https://github.com/automerge/automerge-perf) typing trace.
