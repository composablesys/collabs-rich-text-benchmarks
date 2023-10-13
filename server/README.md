# server

Web server that serves each framework's rich-text editor and orchestrates the experiment.

## Usage

### Install

```bash
npm ci --legacy-peer-deps
```

(Reason for `--legacy-peer-deps`: Without it, npm does not let you use an alpha version of `@automerge/automerge` to resolve `@automerge/automerge-repo`'s peer dep.)

### Build app (browser code):

```bash
npm run build
```

You will need to rerun this whenever you change `src/site/`.

`npm run dev` is a faster version that outputs less efficient app code.

### Run experiment server:

```bash
npm start <logFolder> <scenario> <numUsers> <framework> <trial> [options [gdocs URL]]
```

where:

- logFolder is the root folder for all experiments' log files
- scenario is one of: ["allActive","noQuill"]
- numUsers is the number of clients to wait for before starting the experiment.
- framework is one of: ["automerge","automergeRepo","collabs","collabsNoVC","yjs","sharedb","gdocs"]
- trial is the name for this trial's log folder. The logs are placed in `<logFolder>/<exp params>/<trial>/`.
- options may include chars (e.g. "xc"):
- 'c' to also collect log files sent by clients (written to the same folder as the server log). For this to work, clients must use the Docker container in `../client/`.
- 'l' to include localhost traffic in the per-process network stats
- 'x' to exit when the experiment ends
- 'b' to enable 1 second sender-side batching (CRDT frameworks only)
- gdocs URL is the editable link for this experiment's Google Doc, if using framework "gdocs".

To set the port, use the `PORT` environment variable (default: 8080). The framework server runs on PORT + 1.

Once you start the server, you can start clients pointing to its URL (see `../client/`). The server will automatically run the experiment once `numUsers` clients have connected, then terminate itself when finished.

You can also visit the page in a browser yourself. That doesn't count towards `numUsers`.

To view the experiment's status, open `<server URL>/status` in a web browser (e.g. [localhost:8080/status](http://localhost:8080/status)). It will refresh every 10 seconds. If it fails to refresh, that means the server has terminated, hopefully because the experiment finished (when using the `x` option.)

#### Google Docs only

For framework "gdocs", you will first need to create a blank Google Doc, set permissions to "Editor - Anyone with the link", and supply the editable share link as the `gdocs URL` arg (after `options`). All users will edit that doc. Note that after one trial, the doc will contain a bunch of text, so you should use a fresh doc for the next trial.

### Run full experiment on AWS:

Instead of running `npm start` and separately running the clients, you can use `npm run aws` to run an entire experiment, _assuming_ you're using our AWS setup (from `../aws/`).

Requirements:

- The command must be run on an AWS EC2 instance. The server will also run on that instance.
- The EC2 instance must have the AWS CLI installed and logged-in, with permission to launch AWS ECS tasks.
- You must edit the `--cluster` and `--task-definition` args in `src/aws/main.ts` to correspond to your Fargate cluster/task definition names. There are 4 commands, for 2 regions times the two task definitions (8 x 0.5 vcpu vs 4 x 1 vcpu).

You can also edit and run `aws_multi.sh` (again on the AWS EC2 instance) to run multiple experiments in a row automatically. It will try once to retry each experiment that fails to start (e.g., due to Fargate Spot containers getting killed prematurely - this manifests as server error "Client sent logs early; it must have exited early.").

## Organization

- `src/site`: Source for the browser side of the app, built with Webpack (`npm run build`, or `npm run dev` for dev mode). The app code is shared by all frameworks; when you connect to the server, it will redirect you to the framework set in the server's command line arg, by adding URL query params.
- `src/server`: Source for the server. This serves static content, orchestrates the experiment, outputs stats, and starts & stops a framework-specific server (for routing updates between clients).
- `src/aws`: Source for `npm run aws` command.
- `automerge/`, `sharedb/`: Custom servers for those frameworks.
