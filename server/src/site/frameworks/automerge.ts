import { next as Automerge } from "@automerge/automerge";
import Quill from "quill";
import { AutomergeCustomMessage } from "../../../generated/proto_compiled";
import { SyncFramework } from "../sync_framework";
import {
  IDocHandle,
  setupAutomergeQuillBinding,
} from "./custom_integrations/automerge_quill";

export class AutomergeFramework implements SyncFramework {
  readonly ready: Promise<void>;
  private readonly docHandle: WsDocHandle<{ text: string }>;

  constructor(
    wsURL: string,
    // TODO: we don't use this yet
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    this.docHandle = new WsDocHandle(wsURL, batchRemoteMS, batchSendMS);

    this.ready = new Promise(async (resolve) => {
      // Wait for the server to share the document with us.
      await this.docHandle.loaded;
      setupAutomergeQuillBinding(this.docHandle, editor);
      resolve();
    });
  }

  getSavedState() {
    return Automerge.save(this.docHandle.docSync()!);
  }
}

class WsDocHandle<T> implements IDocHandle<T> {
  private doc: Automerge.Doc<T>;

  private readonly ws: WebSocket;
  private changeHandler:
    | ((arg: { doc: Automerge.Doc<T>; patches: Automerge.Patch[] }) => void)
    | null = null;

  readonly loaded: Promise<void>;

  constructor(
    wsURL: string,
    private readonly batchRemoteMS: number | null,
    private readonly batchSendMS: number | null
  ) {
    this.doc = Automerge.load(makeBaseState());

    this.ws = new WebSocket(wsURL);
    this.ws.binaryType = "arraybuffer";

    let isLoaded = false;
    let toLoad: Uint8Array[] = [];
    this.loaded = new Promise((resolve) => {
      this.ws.onmessage = (e) => {
        if (isLoaded) this.receive(new Uint8Array(e.data as ArrayBuffer));
        else {
          if (e.data === "loaded") {
            [this.doc] = Automerge.applyChanges(this.doc, toLoad);
            toLoad = [];
            isLoaded = true;
            resolve();
          } else {
            const changes = AutomergeCustomMessage.decode(
              new Uint8Array(e.data as ArrayBuffer)
            ).changes;
            toLoad.push(...changes);
          }
        }
      };
    });
  }

  private nextReceiveBatch: Uint8Array[] = [];
  private receive(message: Uint8Array) {
    const changes = AutomergeCustomMessage.decode(message).changes;
    if (this.batchRemoteMS === null) this.deliver(changes);
    else {
      if (this.nextReceiveBatch.length === 0) {
        // Start a new batch.
        setTimeout(() => {
          const batch = this.nextReceiveBatch;
          this.nextReceiveBatch = [];
          this.deliver(batch);
        }, this.batchRemoteMS);
      }
      this.nextReceiveBatch.push(...changes);
    }
  }

  private deliver(messages: Uint8Array[]): void {
    const allPatches: Automerge.Patch[] = [];
    [this.doc] = Automerge.applyChanges(this.doc, messages, {
      patchCallback: (patches) => allPatches.push(...patches),
    });
    // Deliver all patches at once, so Quill only renders once.
    if (this.changeHandler) {
      this.changeHandler({ doc: this.doc, patches: allPatches });
    }
  }

  isReady(): boolean {
    return this.doc !== undefined;
  }

  docSync(): T | undefined {
    return this.doc;
  }

  on(
    event: "change",
    handler: (arg: {
      doc: Automerge.Doc<T>;
      patches: Automerge.Patch[];
    }) => void
  ): void {
    this.changeHandler = handler;
  }

  private pendingChanges: Uint8Array[] = [];
  change(callback: (doc: T) => void): void {
    // Following https://automerge.org/docs/cookbook/real-time/#changes-interface
    const oldDoc = this.doc!;
    this.doc = Automerge.change(oldDoc, callback);
    const change = Automerge.getLastLocalChange(this.doc);
    if (change === undefined) return;

    if (this.batchSendMS === null) {
      // Send immediately.
      // We just assume the WebSocket is open.
      this.ws.send(
        AutomergeCustomMessage.encode({ changes: [change] }).finish()
      );
    } else {
      if (this.pendingChanges.length === 0) {
        // Schedule a batch send.
        setTimeout(() => {
          const changes = this.pendingChanges;
          this.pendingChanges = [];
          this.ws.send(AutomergeCustomMessage.encode({ changes }).finish());
        }, this.batchSendMS);
      }
      this.pendingChanges.push(change);
    }
  }
}

function makeBaseState(): Uint8Array {
  // To match Quill's initial state, start with text "\n".
  return Automerge.save(Automerge.from({ text: "\n" }, { actor: "BACE" }));
}
