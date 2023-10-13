import { CRichText, CRuntime } from "@collabs/collabs";
import Delta from "quill-delta";
import { Doc } from "./doc";

export class CollabsDoc implements Doc {
  readonly doc: CRuntime;
  readonly text: CRichText;

  constructor() {
    this.doc = new CRuntime();
    this.text = this.doc.registerCollab("text", (init) => new CRichText(init));
  }

  load(savedState: Uint8Array): void {
    this.doc.load(savedState);
  }

  save(): Uint8Array {
    return this.doc.save();
  }

  toQuill(): Delta {
    let delta = new Delta();
    for (const span of this.text.formatted()) {
      delta = delta.insert(span.values, collabsAttrToQuill(span.format));
    }
    return delta;
  }
}

// Copied from site's Collabs-Quill integration.
const exclusiveBlocks = new Set(["blockquote", "header", "list", "code-block"]);
function collabsAttrToQuill(attrs: Record<string, any>): Record<string, any> {
  const ret: Record<string, any> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "block") {
      if (value === undefined) {
        // Instead of figuring out which block key is being unmarked,
        // just ask Quill to unmark all of them.
        for (const blockKey of exclusiveBlocks) ret[blockKey] = null;
      } else {
        const [quillKey, quillValue] = JSON.parse(value) as [string, any];
        ret[quillKey] = quillValue;
      }
    } else ret[key] = value ?? null;
  }
  return ret;
}
