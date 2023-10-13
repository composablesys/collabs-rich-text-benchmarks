import { next as Automerge } from "@automerge/automerge";
import Delta from "quill-delta";
import { Doc } from "./doc";

export class AutomergeDoc implements Doc {
  doc!: Automerge.Doc<{ text: string }>;

  load(savedState: Uint8Array): void {
    this.doc = Automerge.load(savedState);
  }

  save(): Uint8Array {
    return Automerge.save(this.doc);
  }

  toQuill(): Delta {
    let delta = new Delta().insert(this.doc.text);
    for (const mark of Automerge.marks(this.doc, ["text"])) {
      delta = delta.compose(
        new Delta()
          .retain(mark.start)
          .retain(
            mark.end - mark.start,
            automergeAttrToQuill({ [mark.name]: mark.value })
          )
      );
    }
    return delta;
  }
}

// Copied from site's Automerge-Quill integration.
const exclusiveBlocks = new Set(["blockquote", "header", "list", "code-block"]);
function automergeAttrToQuill(attrs: Record<string, any>): Record<string, any> {
  const ret: Record<string, any> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "block") {
      // unmark() ops create a MarkPatch with a null
      // value instead of an Unmark patch.
      // So a null value is possible even though this function is only called
      // for splice & mark patches.
      if (value === null) {
        // Instead of figuring out which block key is being unmarked,
        // just ask Quill to unmark all of them.
        for (const blockKey of exclusiveBlocks) ret[blockKey] = null;
      } else {
        const [quillKey, quillValue] = JSON.parse(value) as [string, any];
        ret[quillKey] = quillValue;
      }
    } else ret[key] = value;
  }
  return ret;
}
