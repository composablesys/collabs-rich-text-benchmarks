import {
  CPresence,
  CRichText,
  CRuntime,
  Cursor,
  Cursors,
} from "@collabs/collabs";
import Quill, { DeltaStatic, Delta as DeltaType } from "quill";
import QuillCursors from "quill-cursors";

const Delta: typeof DeltaType = Quill.import("delta");

export const noGrowAtEnd = [
  // Links (Peritext Example 9)
  "link",
  // Block formatting - should only apply to the "\n"
  "block",
];
/**
 * These formats are exclusive; we need to pass only one at a time to Quill or
 * the result is inconsistent.
 * So, we wrap them in our own "block" formatting attribute:
 * { block: [key, value] }.
 */
const exclusiveBlocks = new Set(["blockquote", "header", "list", "code-block"]);

const nameParts = ["Cat", "Dog", "Rabbit", "Mouse", "Elephant"];

export interface PresenceState {
  name: string;
  color: string;
  selection: { anchor: Cursor; head: Cursor } | null;
}

export function setupCollabsQuillBinding(
  doc: CRuntime,
  text: CRichText,
  quill: Quill,
  presence?: CPresence<PresenceState>
) {
  // Reflect Collab operations in Quill.
  // Note that for local operations, Quill has already updated
  // its own representation, so we should skip doing so again.

  let ourChange = false;
  function updateContents(delta: DeltaStatic) {
    ourChange = true;
    quill.updateContents(delta);
    ourChange = false;
  }

  let pendingDelta: DeltaStatic = new Delta();

  text.on("Insert", (e) => {
    if (e.meta.isLocalOp) return;

    pendingDelta = pendingDelta.compose(
      new Delta().retain(e.index).insert(e.values, collabsAttrToQuill(e.format))
    );
  });

  text.on("Delete", (e) => {
    if (e.meta.isLocalOp) return;

    pendingDelta = pendingDelta.compose(
      new Delta().retain(e.index).delete(e.values.length)
    );
  });

  text.on("Format", (e) => {
    if (e.meta.isLocalOp) return;

    pendingDelta = pendingDelta.compose(
      new Delta()
        .retain(e.startIndex)
        .retain(
          e.endIndex - e.startIndex,
          collabsAttrToQuill({ [e.key]: e.value })
        )
    );
  });

  (text.runtime as CRuntime).on("Change", (e) => {
    if (!e.isLocalOp && pendingDelta.ops!.length !== 0) {
      // Send the pendingDelta to Quill.
      // We wait until "Change" so this only happens once per batch.
      // We don't risk interleaving with Quill's updates because batches
      // are always synchronous, while Quill-driven updates always occur
      // in a DOM event.
      // TODO: will need to adjust this strategy if we allow programmatic ops
      // via CText or Quill manipulation.
      const delta = pendingDelta;
      pendingDelta = new Delta();
      updateContents(delta);
    }
  });

  // Convert user inputs to Collab operations.

  quill.on("text-change", (delta) => {
    // In theory we can listen for events with source "user",
    // to ignore changes caused by Collab events instead of
    // user input.  However, changes that remove formatting
    // using the "remove formatting" button, or by toggling
    // a link off, instead get emitted with source "api".
    // This appears to be fixed only on a not-yet-released v2
    // branch: https://github.com/quilljs/quill/issues/739
    // For now, we manually keep track of whether changes are due
    // to us or not.
    // if (source !== "user") return;
    if (ourChange) return;

    for (const op of getRelevantDeltaOperations(delta)) {
      // Insertion
      if (op.insert) {
        if (typeof op.insert === "string") {
          const quillAttrs = op.attributes ?? {};
          const collabsAttrs = Object.fromEntries(
            [...Object.entries(quillAttrs)].map(quillAttrToCollabs)
          );
          text.insert(op.index, op.insert, collabsAttrs);
        } else {
          // Embed of object
          throw new Error("Embeds not supported");
        }
      }
      // Deletion
      else if (op.delete) {
        text.delete(op.index, op.delete);
      }
      // Formatting
      else if (op.attributes && op.retain) {
        for (const [quillKey, quillValue] of Object.entries(op.attributes)) {
          const [key, value] = quillAttrToCollabs([quillKey, quillValue]);
          text.format(op.index, op.index + op.retain, key, value);
        }
      }
    }
  });

  /**
   * Convert delta.ops into an array of modified DeltaOperations
   * having the form { index: first char index, ...DeltaOperation},
   * leaving out ops that do nothing.
   */
  function getRelevantDeltaOperations(
    delta: DeltaStatic
  ): {
    index: number;
    insert?: string | object;
    delete?: number;
    attributes?: Record<string, any>;
    retain?: number;
  }[] {
    if (delta.ops === undefined) return [];
    const relevantOps = [];
    let index = 0;
    for (const op of delta.ops) {
      if (op.retain === undefined || op.attributes) {
        relevantOps.push({ index, ...op });
      }
      // Adjust index for the next op.
      if (op.insert !== undefined) {
        if (typeof op.insert === "string") index += op.insert.length;
        else index += 1; // Embed
      } else if (op.retain !== undefined) index += op.retain;
      // Deletes don't add to the index because we'll do the
      // next operation after them, hence the text will already
      // be shifted left.
    }
    return relevantOps;
  }

  /**
   * Converts a Quill formatting attr (key/value pair) to the format
   * we store in Collabs: block formatting, null -> undefined.
   */
  function quillAttrToCollabs(
    attr: [key: string, value: any]
  ): [key: string, value: any] {
    const [key, value] = attr;
    if (exclusiveBlocks.has(key)) {
      // Wrap it in our own "block" formatting attribute.
      // See the comment above exclusiveBlocks.
      if (value === null) return ["block", undefined];
      else return ["block", JSON.stringify([key, value])];
    } else {
      return [key, value ?? undefined];
    }
  }

  /**
   * Inverse of quillAttrToCollabs, except acting on a whole object at a time.
   */
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

  // Presence (shared cursors).
  const quillCursors = quill.getModule("cursors") as QuillCursors;
  if (quillCursors && presence) {
    const name =
      nameParts[Math.floor(Math.random() * nameParts.length)] +
      " " +
      (1 + Math.floor(Math.random() * 9));
    const color = `hsl(${Math.floor(Math.random() * 360)},50%,50%)`;
    presence.setOurs({ name, color, selection: null });

    function moveCursor(replicaID: string): void {
      if (replicaID === doc.replicaID) return;
      const value = presence!.get(replicaID);
      if (value === undefined) return;
      else if (value.selection === null) quillCursors.removeCursor(replicaID);
      else {
        try {
          const anchorIndex = Cursors.toIndex(value.selection.anchor, text);
          const headIndex = Cursors.toIndex(value.selection.head, text);
          quillCursors.moveCursor(replicaID, {
            index: anchorIndex,
            length: headIndex - anchorIndex,
          });
        } catch (err) {
          // Since presence is in a separate doc from text, its possible
          // that we could get a Cursor before text receives the corresponding
          // Position, causing an error.
          // For now, just ignore the cursor movement.
          console.error("Error updating shared cursor: " + err);
        }
      }
    }
    presence.on("Set", (e) => {
      if (e.key === doc.replicaID) return;
      if (e.value.selection === null) quillCursors.removeCursor(e.key);
      else {
        quillCursors.createCursor(e.key, e.value.name, e.value.color);
        moveCursor(e.key);
      }
    });
    presence.on("Delete", (e) => quillCursors.removeCursor(e.key));
    quill.on("editor-change", () => {
      // Send our cursor state if needed.
      // Only do this when the user does something (not in reaction to
      // remote Collab events).
      if (!ourChange) {
        const selection = quill.getSelection();
        if (selection === null) {
          if (presence.getOurs()!.selection !== null) {
            presence.updateOurs("selection", null);
          }
        } else {
          const anchor = Cursors.fromIndex(selection.index, text);
          const head = Cursors.fromIndex(
            selection.index + selection.length,
            text
          );
          presence.updateOurs("selection", { anchor, head });
        }
      }

      // Move everyone else's cursors locally.
      // (I guess Quill would OT this for us, though not necessarily with the
      // exact same indices for all clients. We do it ourselves just in case.)
      for (const replicaID of presence.keys()) moveCursor(replicaID);
    });

    // Presence connect & disconnect.
    // Since the demo server delivers old messages shortly after starting, wait
    // a second for those to pass before connecting. Otherwise the messages
    // (which look new) make old users appear present.
    setTimeout(() => presence.connect(), 1000);
  }
}
