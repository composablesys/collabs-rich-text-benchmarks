import Delta from "quill-delta";

export interface Doc {
  load(savedState: Uint8Array): void;
  save(): Uint8Array;
  toQuill(): Delta;
}
