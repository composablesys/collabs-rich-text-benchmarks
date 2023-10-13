import Quill from "quill";
import "quill/dist/quill.snow.css";
import { QuillBinding } from "y-quill";
import * as Y from "yjs";
import { SyncFramework } from "../sync_framework";
import { BatchWebsocketProvider } from "./custom_integrations/batch_y_websocket";
import { makeBatchWebSocket } from "./custom_integrations/make_batch_websocket";

export class YjsFramework implements SyncFramework {
  readonly ready: Promise<void>;
  private readonly doc: Y.Doc;
  private readonly wsProvider: BatchWebsocketProvider;

  constructor(
    wsURL: string,
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    this.doc = new Y.Doc();
    const text = this.doc.getText("quill");

    const BatchWebSocket = makeBatchWebSocket(
      WebSocket,
      batchRemoteMS,
      this.doc.transact.bind(this.doc)
    );
    this.wsProvider = new BatchWebsocketProvider(wsURL, docID, this.doc, {
      WebSocketPolyfill: BatchWebSocket,
      // Disable cross-tab sync - always use the server.
      disableBc: true,
      batchSendMS,
    });
    this.wsProvider.shouldConnect = true;

    this.ready = new Promise((resolve) => {
      const handler = (isSynced: boolean) => {
        if (isSynced) {
          resolve();
          this.wsProvider.off("synced", handler);
        }
      };
      this.wsProvider.on("synced", handler);
    });

    new QuillBinding(text, editor /*, wsProvider.awareness*/);
  }

  getSavedState() {
    return Y.encodeStateAsUpdate(this.doc);
  }
}
