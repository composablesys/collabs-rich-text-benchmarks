import Quill, { DeltaStatic, Delta as DeltaType } from "quill";
import ReconnectingWebSocket from "reconnecting-websocket";
// @ts-ignore No typedefs available
import richText from "rich-text";
import sharedb from "sharedb/lib/client";
import { Socket } from "sharedb/lib/sharedb";
import { SyncFramework } from "../sync_framework";
import { makeBatchWebSocket } from "./custom_integrations/make_batch_websocket";

// Modified from https://github.com/share/sharedb/blob/master/examples/rich-text/client.js

const Delta: typeof DeltaType = Quill.import("delta");

export class ShareDBFramework implements SyncFramework {
  readonly ready: Promise<void>;
  private readonly doc: sharedb.Doc<any>;

  constructor(
    wsURL: string,
    docID: string,
    editor: Quill,
    batchRemoteMS: number | null,
    batchSendMS: number | null
  ) {
    if (batchSendMS) {
      // Ignored - ShareDB chooses its sender batch time based on server load.
      console.log("Not supported: batchSendMS for ShareDB");
    }

    sharedb.types.register(richText.type);

    // Open WebSocket connection to ShareDB server
    const BatchReconnectingWebSocket = makeBatchWebSocket(
      ReconnectingWebSocket,
      batchRemoteMS,
      batchWrapper
    );
    const socket = new BatchReconnectingWebSocket(wsURL, [], {
      // ShareDB handles dropped messages, and buffering them while the socket
      // is closed has undefined behavior
      maxEnqueuedMessages: 0,
    });
    const connection = new sharedb.Connection(socket as Socket);

    let pendingDelta: DeltaStatic = new Delta();

    const doc = connection.get("a", docID);
    this.doc = doc;
    this.ready = new Promise((resolve, reject) => {
      doc.subscribe(function (err) {
        if (err) reject(err);
        editor.setContents(doc.data);
        editor.on("text-change", function (delta, oldDelta, source) {
          if (source !== "user") return;
          doc.submitOp(delta, { source: editor });
        });
        doc.on("op", function (op, source) {
          if (source === editor) return;
          pendingDelta = pendingDelta.compose((op as unknown) as DeltaStatic);
        });
        resolve();
      });
    });

    function batchWrapper(f: () => void) {
      f();
      if (pendingDelta.ops!.length !== 0) {
        const delta = pendingDelta;
        pendingDelta = new Delta();
        editor.updateContents(delta);
      }
    }
  }

  getSavedState() {
    // ShareDB suggests JSON serialization, so that's what we use:
    // https://share.github.io/sharedb/api/doc#tosnapshot
    // @ts-expect-error Types outdated.
    return JSON.stringify(this.doc.toSnapshot());
  }
}
