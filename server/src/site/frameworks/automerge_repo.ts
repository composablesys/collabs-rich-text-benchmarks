import { next as Automerge } from "@automerge/automerge";
import { DocHandle, Repo } from "@automerge/automerge-repo";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import Quill from "quill";
import { SyncFramework } from "../sync_framework";
import { setupAutomergeQuillBinding } from "./custom_integrations/automerge_quill";

export class AutomergeRepoFramework implements SyncFramework {
  readonly ready: Promise<void>;
  private docHandle: DocHandle<{ text: string }> | null = null;

  constructor(
    wsURL: string,
    // Not used - the server auto-assigns a docID.
    docID: string,
    editor: Quill,
    // TODO: how to batch remote updates?
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    if (batchSendMS !== null) {
      // Ignored - automerge-repo does its own sync protocol.
      console.log("Not supported: batchSendMS for automerge-repo");
    }
    const repo = new Repo({
      network: [new BrowserWebSocketClientAdapter(wsURL)],
    });

    this.ready = new Promise((resolve) => {
      // Wait for the server to share the document with us.
      repo.on("document", async (payload) => {
        if (this.docHandle !== null) {
          throw new Error("Got two documents");
        }
        this.docHandle = payload.handle;
        await this.docHandle.whenReady();
        setupAutomergeQuillBinding(this.docHandle, editor);
        resolve();
      });
    });
  }

  getSavedState() {
    return Automerge.save(this.docHandle!.docSync());
  }
}
