import Delta from "quill-delta";
import * as Y from "yjs";
import { Doc } from "./doc";

export class YjsDoc implements Doc {
  readonly doc = new Y.Doc();

  load(savedState: Uint8Array): void {
    Y.applyUpdate(this.doc, savedState);
  }

  save(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  toQuill(): Delta {
    return new Delta(this.doc.getText("quill").toDelta());
  }
}
