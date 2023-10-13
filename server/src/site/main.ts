import { fromByteArray } from "base64-js";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { AutomergeFramework } from "./frameworks/automerge";
import { AutomergeRepoFramework } from "./frameworks/automerge_repo";
import { CollabsFramework, CollabsNoVCFramework } from "./frameworks/collabs";
import { ShareDBFramework } from "./frameworks/sharedb";
import { YjsFramework } from "./frameworks/yjs";
import { NoQuill } from "./no_quill";
import { SyncFramework, SyncFrameworkClass } from "./sync_framework";

// --- Settings ---

// Realistic docID (a UUID).
const docID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

// Only send remote updates to Quill once every 50 ms, to prevent Quill
// from being a bottleneck. This at worst increases user-perceived remote
// latency by 50ms.
const batchRemoteMS = 50;
// If sender-side batching is enabled by the server ('b' option),
// the batch size in ms. Clients (except ShareDB and automerge-repo) will send at most one
// message to the server every batch. This reduces the server's load and
// also reduces the time that other client spend in Quill code, by grouping
// related ops.
const batchSendMSIfEnabled = 1000;

const FRAMEWORKS: {
  [framework: string]: SyncFrameworkClass;
} = {
  automerge: AutomergeFramework,
  automergeRepo: AutomergeRepoFramework,
  collabs: CollabsFramework,
  collabsNoVC: CollabsNoVCFramework,
  sharedb: ShareDBFramework,
  yjs: YjsFramework,
  // @ts-expect-error
  gdocs: "fake",
};
const SCENARIOS = new Set(["allActive", "noQuill"]);

// Which framework is given by the "framework" URL param.
const searchParams = new URLSearchParams(window.location.search);
if (!searchParams.has("framework")) {
  throw new Error("No framework specified in URL params");
}
const frameworkName = <keyof typeof FRAMEWORKS>searchParams.get("framework")!;
if (FRAMEWORKS[frameworkName] === undefined) {
  throw new Error(`Unrecognized framework: ${frameworkName}`);
}
// Which scenario is given by the "scenario" URL param.
if (!searchParams.has("scenario")) {
  throw new Error("No scenario specified in URL params");
}
const scenario = searchParams.get("scenario")!;
if (!SCENARIOS.has(scenario)) {
  throw new Error(`Unrecognized scenario: ${scenario}`);
}
// Whether to batch sent ops is given by the "senderBatch" URL param.
if (!searchParams.has("senderBatch")) {
  throw new Error("No senderBatch specified in URL params");
}
const senderBatch = searchParams.get("senderBatch") === "true";

const isGdocs = frameworkName === "gdocs";
let gdocsUrl: string | undefined = undefined;
if (isGdocs) {
  if (!searchParams.has("gdocsUrl")) {
    throw new Error(
      "Framework is gdocs, but no gdocsUrl specified in URL params"
    );
  }
  gdocsUrl = decodeURIComponent(searchParams.get("gdocsUrl")!);
}

// Server's WebSocket URL.
const port =
  location.port === ""
    ? location.protocol === "http"
      ? 80
      : 443
    : Number.parseInt(location.port);
const wsPort = port + 1;
const wsProtocol = location.protocol.replace(/^http/, "ws");
const wsURL = wsProtocol + "//" + location.hostname + ":" + wsPort;

console.log(
  JSON.stringify({
    type: "info",
    process: "site",
    framework: frameworkName,
    wsURL,
    gdocsUrl,
  })
);

if (isGdocs) console.log("GDOCS:" + gdocsUrl!);
else console.log("GDOCS:false");

// --- Setup Quill editor ---

let editor: Quill | undefined = undefined;
if (!isGdocs) {
  // Disable cursors for now because they are a bottleneck that does
  // not involve CRDTs and probably can be optimized out.
  // Also, I couldn't find up-to-date ShareDB cursor support.
  // To re-enable, uncomment the next line and "cursors: true," below.

  // Quill.register("modules/cursors", QuillCursors);

  const editorContainer = document.createElement("div");
  editorContainer.setAttribute("id", "editor");
  document.body.insertBefore(editorContainer, null);

  if (scenario === "allActive") {
    editor = new Quill(editorContainer, {
      theme: "snow",
      modules: {
        // cursors: true,
        toolbar: [
          ["bold", "italic"],
          [{ header: "1" }, { header: "2" }],
          [{ list: "ordered" }, { list: "bullet" }],
        ],
        history: {
          userOnly: true,
        },
      },
      formats: ["bold", "italic", "header", "list"],
    });
  } else {
    // "noQuill"
    editor = new NoQuill(editorContainer);
  }
}

// --- Experiment stuff ---

/**
 * Puppeteer function to let us know when Puppeteer is ready,
 * and that we're being controlled by Puppeteer.
 * (Otherwise, we skip telling the server that we're a client, so that
 * the experimenter can open this page without claiming a client's spot).
 */
const puppeteerPromise = new Promise<void>(
  (resolve) => ((window as any).puppeteerReady = resolve)
);

if (!isGdocs) {
  /**
   * Puppeteer function to change the selection/cursor.
   * If it's out of bounds, we wrap around or clamp.
   *
   * @param starfDiff How far to move the selection's start relative to its
   * current index.
   * @param length The selection length.
   */
  (window as any).changeSelection = (startDiff: number, length = 0) => {
    // Use length (not +1) b/c you can't place the cursor after the final "\n".
    const textLength = editor!.getLength();
    const currentSel = editor!.getSelection();
    let newIndex = ((currentSel?.index ?? 0) + startDiff) % textLength;
    if (newIndex < 0) newIndex += textLength;
    length = Math.min(length, textLength - newIndex);
    editor!.setSelection(newIndex, length, "user");
  };

  // Log when we see a sigil.
  // Each sigil is 4 chars (forming a unique word), followed by "@".
  const SIGIL_END = "@";
  editor!.on("text-change", (delta) => {
    // console.log(delta, editor.getContents(0, editor.getLength()));
    if (delta.ops === undefined) return;
    let index = 0;
    for (const op of delta.ops) {
      if (typeof op.insert === "string") {
        const sigilIndex = op.insert.indexOf(SIGIL_END);
        if (sigilIndex !== -1) {
          // Sigil is the 4 chars before @.
          // op.insert starts at index.
          const startIndex = index + sigilIndex - 4;
          if (startIndex >= 0) {
            // This call should not be expensive enough to distort CPU usage -
            // Quill will just scan the current content (which is already computed)
            // up to startIndex + 4.
            const sigil = editor!.getText(startIndex, 4);
            // Ignore definitely-interleaved sigils that will confuse the client.
            if (!(sigil.includes("\n") || sigil.includes(","))) {
              reportSigil(sigil);
            }
          }
        }
        index += op.insert.length;
      } else if (op.retain !== undefined) index += op.retain;
    }
  });

  function reportSigil(sigil: string): void {
    if (scenario === "noQuill") {
      // No rendering, so report immediately.
      console.log("S:n," + sigil);
    } else {
      // We want to report the sigil when it's *rendered*, not just when Quill
      // emits text-change (which is at the end of the task that updates the HTML).
      // requestAnimationFrame waits until just *before* the next render and is
      // probably most accurate.
      // We also queue a task during requestAnimationFrame, which will run *after*
      // the render completes, but possibly long after (if a different long task
      // runs first).
      window.requestAnimationFrame(() => {
        // Use a short output form for sigils, since they dominate the output
        // and can fill 100s of MB total.
        console.log("S:a," + sigil);
        setTimeout(() => console.log("S:b," + sigil));
      });
    }
  }

  // Every 10 seconds, output Quill doc size stats.
  // (We don't output framework.getSavedState() until the end ("/profile" section),
  // since that's expensive.)
  setInterval(() => {
    const length = editor!.getLength();
    const ops = editor!.getContents(0, length).ops!.length;
    console.log(JSON.stringify({ type: "size", length, ops }));
  }, 10000);
}

// Collect long task durations and output them every 10 seconds.
let taskLengths: number[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    taskLengths.push(Math.round(entry.duration));
  }
});
observer.observe({ type: "longtask" });
setInterval(() => {
  if (taskLengths.length !== 0) {
    // Durations are in ms.
    console.log(JSON.stringify({ type: "longtask", taskLengths }));
    taskLengths = [];
  }
}, 10000);

// --- Start SyncFramework ---

let framework: SyncFramework | undefined = undefined;
let readyPromise: Promise<void>;

if (isGdocs) {
  readyPromise = Promise.resolve();
} else {
  framework = new FRAMEWORKS[frameworkName](
    wsURL,
    docID,
    editor!,
    batchRemoteMS,
    senderBatch ? batchSendMSIfEnabled : null
  );
  readyPromise = framework.ready;
  console.log(JSON.stringify({ type: "connecting" }));
}

readyPromise.then(async () => {
  console.log(JSON.stringify({ type: "siteReady" }));

  // This will only resolve if we're actually an experiment client being
  // controlled by Puppeteer.
  await puppeteerPromise;

  // Let the server know that we're ready.
  // It will respond once it is time for the experiment to start.
  let response: Response;
  try {
    response = await fetch("/ready", { method: "post" });
    if (!response.ok) {
      console.error("Fetch failure: ready, not ok,", response);
      return;
    }
  } catch (err) {
    console.error("Fetch failure: ready, reject,", err);
    return;
  }

  // Tell puppeteer to start.
  const text = await response.text();
  console.log("START:" + text);

  const { userID } = JSON.parse(text) as {
    userID: number;
  };
  if (userID === 0 || userID === 1 || userID === 2) {
    // Collect perf info after the end of measurements but while all clients
    // are still running.
    fetch("/profile", { method: "post" }).then((profileRes) => {
      if (profileRes.ok) {
        if (userID === 0 || userID === 1) {
          // Tell Puppeteer to record a CPU profile.
          // userID 0 records a normal profile, userID 1 records a highFreq
          // profile (shorter sampling interval).
          console.log("PROFILE" + userID);
        } else {
          if (!isGdocs) {
            // Record the framework's doc's saved state & its size.
            const length = editor!.getLength();
            const quillState = editor!.getContents(0, length).ops!;
            const ops = quillState.length;
            const quillSaveSize = JSON.stringify(quillState).length;

            const savedState = framework!.getSavedState();
            if (typeof savedState === "string") {
              // Technically, the string length could be 2 * byteLength if there are
              // non-ASCII chars, but our benchmarks don't use any.
              console.log(
                JSON.stringify({
                  type: "savedSize",
                  savedSize: savedState.length,
                  length,
                  ops,
                  quillSaveSize,
                  saveType: "string",
                  savedState,
                })
              );
            } else {
              console.log(
                JSON.stringify({
                  type: "savedSize",
                  savedSize: savedState.byteLength,
                  length,
                  ops,
                  quillSaveSize,
                  saveType: "Uint8Array",
                  // base64 encoded
                  savedState: fromByteArray(savedState),
                })
              );
            }
          }
        }
      } else console.error("Profile response not ok", profileRes);
    });
  }

  fetch("/end", { method: "post" })
    .then((endRes) => {
      // Tell puppeteer to stop.
      if (endRes.ok) console.log("END");
      else console.error("Fetch failure: end, not ok,", endRes);
    })
    .catch((err) => console.error("Fetch failure: end, reject,", err));
});
