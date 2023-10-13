# client

Node.js program that uses [Puppeteer](https://pptr.dev/) to run a client, i.e., open the server's page in Chromium and simulate user activity.

## Usage

### Install

```bash
npm ci
```

### Run one experiment client:

Set the `URL` environment variable to the server's URL, then run

```bash
npm start
```

The server will tell the client which scenario to use, its `userID`, and when to start and stop simulating user activity. Unless something goes wrong, the client will terminate itself at the end of the experiment.

E.g. for local testing:

```bash
URL="http://localhost:8080/" npm start
```

## Local testing script

For easy local testing, `local_exp.sh` runs a server and clients together on the local machine.

Usage:

```bash
bash local_exp.sh <logFolder> <scenario> <numUsers> <framework> <trial>
```

where:

- logFolder is the root folder for all experiments' log files
- scenario is one of: ["allActive","noQuill"]
- numUsers is the number of clients to wait for before starting the experiment.
- framework is one of: ["automerge","automergeRepo","collabs","collabsNoVC","yjs","sharedb","gdocs"]
- trial is the name for this trial's log folder. The logs are placed in `<logFolder>/<exp params>/<trial>/`.

E.g.:

```
bash local_exp.sh ../data allActive 4 collabs trial0
```

Once you've run as many trials as you want, you can analyze all trials using the analysis script (see `../analysis/`); for its input dir, use `<logFolder>/<exp params>/`.

Note: `local_exp.sh` assumes that ports 8080 and 8081 are available for the server to use.

## Docker container

The `Dockerfile` builds a Docker container containing the client.

To run the container, you will need to set the `URL` environment variable.

E.g.:

```bash
docker build -t client .
docker run -e "URL=http://192.168.1.175:8080/" client
```

See `../aws/` for help running this container on AWS ECS.
