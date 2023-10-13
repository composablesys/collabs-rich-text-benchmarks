import { CRichText, CRuntime } from "@collabs/collabs";
import { WebSocketNetwork } from "@collabs/ws-client";
import Quill from "quill";
import { SyncFramework } from "../sync_framework";
import {
  noGrowAtEnd,
  setupCollabsQuillBinding,
} from "./custom_integrations/collabs_quill";

class CollabsFrameworkBase implements SyncFramework {
  readonly ready: Promise<void>;
  private readonly doc: CRuntime;
  private readonly wsNetwork: WebSocketNetwork;

  constructor(
    wsURL: string,
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null,
    noVectorClocks: boolean
  ) {
    this.doc = new CRuntime({ causalityGuaranteed: noVectorClocks });
    const text = this.doc.registerCollab(
      "text",
      (init) => new CRichText(init, { noGrowAtEnd })
    );
    // const presence = doc.registerCollab(
    //   "presence",
    //   (init) => new CPresence<PresenceState>(init)
    // );

    // "Set the initial state"
    // (a single "\n", matching Quill's initial state) by
    // loading it from a separate doc.
    // See https://collabs.readthedocs.io/en/latest/advanced/initial_values.html#loading-a-base-state
    this.doc.load(makeBaseState());

    setupCollabsQuillBinding(this.doc, text, editor /*, presence */);

    this.wsNetwork = new WebSocketNetwork(wsURL);
    this.wsNetwork.on("Disconnect", (e) => {
      // After a disconnection, try to reconnect every 2 seconds, unless
      // we deliberately called wsNetwork.disconnect().
      if (e.cause === "manual") return;
      console.error("WebSocket disconnected due to", e.cause, e.wsEvent);
      setTimeout(() => {
        console.log("Reconnecting...");
        this.wsNetwork.connect();
      }, 2000);
    });

    this.ready = new Promise((resolve) =>
      this.wsNetwork.on("Load", () => resolve(), { once: true })
    );

    this.wsNetwork.subscribe(this.doc, docID, {
      batchRemoteMS: batchRemoteMS ?? undefined,
      batchSendMS: batchSendMS ?? undefined,
    });
  }

  getSavedState() {
    return this.doc.save();
  }
}

function makeBaseState(): Uint8Array {
  const doc = new CRuntime({ debugReplicaID: "BASE" });
  const clientText = doc.registerCollab(
    "text",
    (init) => new CRichText(init, { noGrowAtEnd })
  );
  doc.transact(() => clientText.insert(0, "\n", {}));
  return doc.save();
}

export class CollabsFramework extends CollabsFrameworkBase {
  constructor(
    wsURL: string,
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    super(wsURL, docID, editor, batchRemoteMS, batchSendMS, false);
  }
}

export class CollabsNoVCFramework extends CollabsFrameworkBase {
  constructor(
    wsURL: string,
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    super(wsURL, docID, editor, batchRemoteMS, batchSendMS, true);
  }
}
