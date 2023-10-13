import { Blot } from "parchment/dist/src/blot/abstract/blot";
import Quill, {
  BoundsStatic,
  ClipboardStatic,
  DeltaOperation,
  DeltaStatic,
  Delta as DeltaType,
  EditorChangeHandler,
  EventEmitter,
  KeyboardStatic,
  RangeStatic,
  SelectionChangeHandler,
  Sources,
  StringMap,
  TextChangeHandler,
} from "quill";

const Delta: typeof DeltaType = Quill.import("delta");

const inlineFormats = new Set(["italic", "bold"]);

export class NoQuill implements Quill {
  private contents: DeltaStatic = new Delta().insert("\n");

  private selStart = 0;
  private selEnd = 0;
  private cursorFormat: Record<string, any> = {};

  private readonly textChangeHandlers = new Set<TextChangeHandler>();

  constructor(container: Element) {
    const ourDiv = document.createElement("div");
    ourDiv.tabIndex = 1;
    ourDiv.className = "ql-editor";
    ourDiv.innerText = "NoQuill - non-rendered editor";
    container.appendChild(ourDiv);

    const headerDiv = document.createElement("div");
    // Use divs instead of buttons so they don't capture Enter.
    const header1 = document.createElement("div");
    header1.innerText = "Header 1";
    header1.className = "ql-header";
    const header2 = document.createElement("div");
    header2.innerText = "Header 2";
    header2.className = "ql-header";
    headerDiv.append(header1, header2);

    const listDiv = document.createElement("div");
    const list1 = document.createElement("div");
    list1.innerText = "Ordered list";
    list1.className = "ql-list";
    const list2 = document.createElement("div");
    list2.innerText = "Bulleted list";
    list2.className = "ql-list";
    listDiv.append(list1, list2);

    ourDiv.append(headerDiv, listDiv);

    // Handle puppeteer input.
    ourDiv.addEventListener("keydown", (e) => {
      if (e.ctrlKey && (e.key === "i" || e.key === "b")) {
        e.preventDefault();

        const formatKey = e.key === "i" ? "italic" : "bold";

        const newValue =
          this.cursorFormat[formatKey] === undefined ? true : null;

        // Update cursorFormat.
        this.cursorFormat = this.clone(this.cursorFormat);
        if (newValue === null) {
          delete this.cursorFormat[formatKey];
        } else this.cursorFormat[formatKey] = newValue;

        if (this.selStart < this.selEnd) {
          // Format the selection.
          this.updateByUser(
            new Delta()
              .retain(this.selStart)
              .retain(this.selEnd - this.selStart, { [formatKey]: newValue })
          );
        }
      } else if (e.key === "Backspace") {
        if (this.selStart !== this.selEnd) {
          throw new Error("Unsupported: bulk backspace");
        }

        e.preventDefault();

        if (this.selStart === 0) return;
        const index = this.selStart;
        this.selStart--;
        this.selEnd--;

        this.inheritCursorFormat();

        this.updateByUser(new Delta().retain(index - 1).delete(1));
      }
    });
    ourDiv.addEventListener("keypress", (e) => {
      if (e.ctrlKey) return;
      if (e.key.length === 1 || e.key === "Enter") {
        if (this.selStart !== this.selEnd) {
          throw new Error("Unsupported: insert that bulk deletes");
        }

        e.preventDefault();

        const index = this.selStart;
        this.selStart++;
        this.selEnd++;

        if (e.key === "Enter") {
          // Copy the current line's format.
          const [, lineAttrs] = this.getLineInfo(index);
          this.updateByUser(new Delta().retain(index).insert("\n", lineAttrs));
        } else {
          this.updateByUser(
            new Delta().retain(index).insert(e.key, this.cursorFormat)
          );
        }
      }
    });

    header1.onclick = () => this.toggleLineFormat("header", 1);
    header2.onclick = () => this.toggleLineFormat("header", 2);
    list1.onclick = () => this.toggleLineFormat("list", "ordered");
    list2.onclick = () => this.toggleLineFormat("list", "bullet");

    // // Primitive display for debugging.
    // const display = document.createElement("div");
    // ourDiv.appendChild(display);
    // this.on("text-change", (delta) => {
    //   console.log(delta, this.contents);
    //   const lines: string[] = [];
    //   let line = "";
    //   for (const op of this.contents.ops!) {
    //     if (op.insert) {
    //       const attrs = op.attributes ?? {};
    //       if (op.insert === "\n") {
    //         if (attrs["header"]) {
    //           line = `<h${attrs["header"]}>` + line + `</h${attrs["header"]}>`;
    //         }
    //         // Don't try to display lists.
    //         lines.push(line);
    //         line = "";
    //       } else {
    //         const parts = op.insert.split("\n");
    //         for (let i = 0; i < parts.length; i++) {
    //           const part = parts[i];
    //           if (attrs["bold"]) line += "<b>";
    //           if (attrs["italic"]) line += "<i>";
    //           line += part;
    //           if (attrs["italic"]) line += "</i>";
    //           if (attrs["bold"]) line += "</b>";
    //           if (i !== parts.length - 1) {
    //             lines.push(line);
    //             line = "";
    //           }
    //         }
    //       }
    //     } else {
    //       throw new Error("Non-insert op in this.contents");
    //     }
    //   }

    //   display.innerHTML = lines.join("<br />");
    // });
  }

  private toggleLineFormat(key: "header" | "list", value: any): void {
    const [index, format] = this.getLineInfo(this.selStart);
    const newFormat: Record<string, any> = {};

    if (format[key] === value) {
      // Toggle it.
      newFormat[key] = null;
    } else {
      // Clear existing format.
      for (const otherKey of ["header", "list"]) {
        if (otherKey !== key) {
          if (format[otherKey]) newFormat[otherKey] = null;
        }
      }
      // Set new format.
      newFormat[key] = value;
    }

    this.updateByUser(new Delta().retain(index).retain(1, newFormat));
  }

  private getLineInfo(
    cursor: number
  ): [index: number, format: Record<string, any>] {
    // Find the next "\n" at or after cursor, which controls this line's
    // format.
    let index = 0;
    for (const op of this.contents.ops!) {
      if (op.insert) {
        const opText = op.insert as string;
        if (index + opText.length > cursor) {
          // This op contains or is past cursor.
          const newline = opText.indexOf("\n", Math.max(0, cursor - index));
          if (newline !== -1) {
            // Found it.
            index += newline;
            const format: Record<string, any> = {};
            if (op.attributes) {
              for (const blockKey of ["header", "list"]) {
                if (op.attributes[blockKey]) {
                  format[blockKey] = op.attributes[blockKey];
                }
              }
            }
            return [index, format];
          }
        }
        index += op.insert.length;
      } else {
        throw new Error("Non-insert op in this.contents");
      }
    }
    throw new Error("No newline found after " + this.selStart);
  }

  private updateByUser(delta: DeltaStatic): void {
    const oldContents = this.contents;
    this.contents = this.contents.compose(delta);

    for (const handler of this.textChangeHandlers) {
      handler(delta, oldContents, "user");
    }
  }

  private clone(attrs: Record<string, any>): Record<string, any> {
    return Object.fromEntries(Object.entries(attrs));
  }

  getModule(name: string) {
    if (name === "cursors") return undefined;
    else throw new Error("Method not implemented.");
  }

  setContents(
    delta: DeltaStatic | DeltaOperation[],
    source: Sources = "api"
  ): DeltaStatic {
    const oldContents = this.contents;
    delta = Array.isArray(delta) ? new Delta(delta) : delta;
    this.contents = delta;

    // ShareDB uses a { retain: 1 } op at the end to set the last newline's attrs.
    if (delta.ops!.at(-1)?.retain === 1) {
      const attrs: Record<string, any> = {};
      for (const [key, value] of Object.entries(
        delta.ops!.at(-1)!.attributes ?? {}
      )) {
        // ShareDB sometimes puts null values. Delete these.
        if (value !== null) attrs[key] = value;
      }
      this.contents = new Delta(this.contents.ops!.slice(0, -1)).insert(
        "\n",
        attrs
      );
    }

    // Append newline if needed, without telling delta.
    // Note: this triggers a y-quill bug:
    // 1. Insert some text w/ a block format for the last line.
    // 2. Refresh the page. Now this "\n" shows up as an extra blank line,
    // since this time, y-quill did supply an ending newline (b/c it's formatted).
    // However, I saw the same bug with actual Quill.
    if (this.contents.ops!.at(-1)?.insert?.at(-1) !== "\n") {
      this.contents = this.contents.compose(
        new Delta().retain(this.getLength()).insert("\n")
      );
    }

    // Reset selection.
    this.selStart = 0;
    this.selEnd = 0;
    this.cursorFormat = {};

    for (const handler of this.textChangeHandlers) {
      handler(delta, oldContents, source);
    }
    return delta;
  }

  updateContents(
    delta: DeltaStatic | DeltaOperation[],
    source: Sources = "api"
  ): DeltaStatic {
    if (source === "silent") {
      throw new Error('Unsupported: "silent" source');
    }

    if (Array.isArray(delta)) {
      // y-quill gives us a non-normalized array of ops; need to construct
      // a normalized delta from these.
      let normDelta = new Delta();
      for (const op of delta) {
        if (op.insert) {
          normDelta = normDelta.insert(
            op.insert,
            this.nullify(op.attributes, false)
          );
        } else if (op.delete) normDelta = normDelta.delete(op.delete);
        else if (op.retain) {
          normDelta = normDelta.retain(
            op.retain,
            this.nullify(op.attributes, true)
          );
        }
      }
      delta = normDelta;
    }

    const oldContents = this.contents;
    this.contents = this.contents.compose(delta);

    // Update selection & cursorFormat.
    let index = 0;
    for (const op of delta.ops!) {
      if (op.insert) {
        // Tested behavior for sel start & end: an insertion exactly at cursor
        // doesn't move it. Hence we use <.
        if (index < this.selEnd) {
          this.selEnd += op.insert.length;
          if (index < this.selStart) {
            this.selStart += op.insert.length;
          }
        } else break;

        index += op.insert.length;
      } else if (op.delete) {
        if (index < this.selEnd) {
          this.selEnd -= op.delete;
          if (index < this.selStart) {
            this.selStart -= op.delete;
          }
        } else break;
      } else {
        // If the (inline) formatting of the char before selStart changes,
        // apply the same change to cursorFormat.
        if (index < this.selStart && this.selStart <= index + op.retain!) {
          if (op.attributes) {
            this.cursorFormat = this.clone(this.cursorFormat);
            for (const [key, value] of Object.entries(op.attributes)) {
              if (inlineFormats.has(key)) {
                if (!value) delete this.cursorFormat[key];
                else this.cursorFormat[key] = value;
              }
            }
          }
        }

        index += op.retain!;
      }
    }

    for (const handler of this.textChangeHandlers) {
      handler(delta, oldContents, source);
    }
    return delta;
  }

  /**
   * Convert falsy values to nulls in attrs, or omit them entirely
   * if keepNulls is false.
   */
  private nullify(
    attrs: Record<string, any> | undefined,
    keepNulls: boolean
  ): Record<string, any> | undefined {
    if (attrs === undefined) return undefined;
    const ans: Record<string, any> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value) ans[key] = value;
      else if (keepNulls) ans[key] = null;
    }
    return ans;
  }

  getContents(
    index?: number | undefined,
    length?: number | undefined
  ): DeltaStatic {
    if (index === undefined || length === undefined) {
      throw new Error("Unsupported: default values");
    }

    return this.contents.slice(index, index + length);
  }

  getLength(): number {
    return this.contents.length();
  }

  getText(index?: number | undefined, length?: number | undefined): string {
    if (index === undefined || length === undefined) {
      throw new Error("Unsupported: default values");
    }

    // Copied from Quill.getText().
    return this.getContents(index, length)
      .filter((op) => typeof op.insert === "string")
      .map((op) => op.insert)
      .join("");
  }

  getSelection(focus: true): RangeStatic;
  getSelection(focus?: false | undefined): RangeStatic | null;
  getSelection(focus?: unknown): RangeStatic | null {
    if (focus) throw new Error("focus not implemented.");

    return { index: this.selStart, length: this.selEnd - this.selStart };
  }

  setSelection(
    index: number,
    length: number,
    source?: Sources | undefined
  ): void;
  setSelection(range: RangeStatic, source?: Sources | undefined): void;
  setSelection(index: unknown, length?: unknown, source?: unknown): void {
    if (typeof index !== "number" || typeof length !== "number") {
      throw new Error("Unsupported: non-number index/length");
    }

    this.selStart = index;
    this.selEnd = index + length;
    this.inheritCursorFormat();

    // With shared cursors disabled, our callers don't care about
    // selection-changed events.
  }

  /**
   * Sets this.cursorFormat to that of the character at selStart - 1.
   */
  private inheritCursorFormat() {
    if (this.selStart === 0) this.cursorFormat = {};
    else {
      const searchIndex = this.selStart - 1;
      let i = 0;
      for (const op of this.contents.ops!) {
        if (op.insert) {
          const opText = op.insert as string;
          if (i + opText.length > searchIndex) {
            // This op contains searchIndex.
            this.cursorFormat = {};
            if (op.attributes) {
              for (const [key, value] of Object.entries(op.attributes)) {
                if (inlineFormats.has(key)) this.cursorFormat[key] = value;
              }
            }
            break;
          }
          i += opText.length;
        } else {
          throw new Error("Non-insert op in this.contents");
        }
      }
    }
  }

  on(eventName: "text-change", handler: TextChangeHandler): EventEmitter;
  on(
    eventName: "selection-change",
    handler: SelectionChangeHandler
  ): EventEmitter;
  on(eventName: "editor-change", handler: EditorChangeHandler): EventEmitter;
  on(eventName: unknown, handler: unknown): EventEmitter {
    switch (eventName) {
      case "editor-change":
        const theHandler = handler as EditorChangeHandler;
        this.textChangeHandlers.add((delta, oldContents, source) =>
          // @ts-ignore
          theHandler("text-change", delta, oldContents, source)
        );
        // With shared cursors disabled, our callers don't care about
        // selection-changed events.
        break;
      case "text-change":
        this.textChangeHandlers.add(handler as TextChangeHandler);
        break;
      default:
        throw new Error(eventName + " not implemented.");
    }

    return this;
  }

  // Not implemented because they are not used by any framework or main.ts.
  get root(): HTMLDivElement {
    throw new Error("Method not implemented.");
  }
  get clipboard(): ClipboardStatic {
    throw new Error("Method not implemented.");
  }
  get scroll(): Blot {
    throw new Error("Method not implemented.");
  }
  get keyboard(): KeyboardStatic {
    throw new Error("Method not implemented.");
  }
  deleteText(
    index: number,
    length: number,
    source?: Sources | undefined
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  disable(): void {
    throw new Error("Method not implemented.");
  }
  enable(enabled?: boolean | undefined): void {
    throw new Error("Method not implemented.");
  }
  insertEmbed(
    index: number,
    type: string,
    value: any,
    source?: Sources | undefined
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  insertText(
    index: number,
    text: string,
    source?: Sources | undefined
  ): DeltaStatic;
  insertText(
    index: number,
    text: string,
    format: string,
    value: any,
    source?: Sources | undefined
  ): DeltaStatic;
  insertText(
    index: number,
    text: string,
    formats: StringMap,
    source?: Sources | undefined
  ): DeltaStatic;
  insertText(
    index: unknown,
    text: unknown,
    format?: unknown,
    value?: unknown,
    source?: unknown
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  pasteHTML(index: number, html: string, source?: Sources | undefined): string;
  pasteHTML(html: string, source?: Sources | undefined): string;
  pasteHTML(index: unknown, html?: unknown, source?: unknown): string {
    throw new Error("Method not implemented.");
  }
  setText(text: string, source?: Sources | undefined): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  update(source?: Sources | undefined): void {
    throw new Error("Method not implemented.");
  }
  format(name: string, value: any, source?: Sources | undefined): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  formatLine(
    index: number,
    length: number,
    source?: Sources | undefined
  ): DeltaStatic;
  formatLine(
    index: number,
    length: number,
    format: string,
    value: any,
    source?: Sources | undefined
  ): DeltaStatic;
  formatLine(
    index: number,
    length: number,
    formats: StringMap,
    source?: Sources | undefined
  ): DeltaStatic;
  formatLine(
    index: unknown,
    length: unknown,
    format?: unknown,
    value?: unknown,
    source?: unknown
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  formatText(
    index: number,
    length: number,
    source?: Sources | undefined
  ): DeltaStatic;
  formatText(
    index: number,
    length: number,
    format: string,
    value: any,
    source?: Sources | undefined
  ): DeltaStatic;
  formatText(
    index: number,
    length: number,
    formats: StringMap,
    source?: Sources | undefined
  ): DeltaStatic;
  formatText(
    range: RangeStatic,
    format: string,
    value: any,
    source?: Sources | undefined
  ): DeltaStatic;
  formatText(
    range: RangeStatic,
    formats: StringMap,
    source?: Sources | undefined
  ): DeltaStatic;
  formatText(
    index: unknown,
    length: unknown,
    format?: unknown,
    value?: unknown,
    source?: unknown
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  getFormat(range?: RangeStatic | undefined): StringMap;
  getFormat(index: number, length?: number | undefined): StringMap;
  getFormat(index?: unknown, length?: unknown): StringMap {
    throw new Error("Method not implemented.");
  }
  removeFormat(
    index: number,
    length: number,
    source?: Sources | undefined
  ): DeltaStatic {
    throw new Error("Method not implemented.");
  }
  blur(): void {
    throw new Error("Method not implemented.");
  }
  focus(): void {
    throw new Error("Method not implemented.");
  }
  getBounds(index: number, length?: number | undefined): BoundsStatic {
    throw new Error("Method not implemented.");
  }
  hasFocus(): boolean {
    throw new Error("Method not implemented.");
  }
  addContainer(classNameOrDomNode: string | Node, refNode?: Node | undefined) {
    throw new Error("Method not implemented.");
  }
  getIndex(blot: any): number {
    throw new Error("Method not implemented.");
  }
  getLeaf(index: number) {
    throw new Error("Method not implemented.");
  }
  getLine(index: number): [any, number] {
    throw new Error("Method not implemented.");
  }
  getLines(index?: number | undefined, length?: number | undefined): any[];
  getLines(range: RangeStatic): any[];
  getLines(index?: unknown, length?: unknown): any[] {
    throw new Error("Method not implemented.");
  }
  once(eventName: "text-change", handler: TextChangeHandler): EventEmitter;
  once(
    eventName: "selection-change",
    handler: SelectionChangeHandler
  ): EventEmitter;
  once(eventName: "editor-change", handler: EditorChangeHandler): EventEmitter;
  once(eventName: unknown, handler: unknown): EventEmitter {
    throw new Error("Method not implemented.");
  }
  off(eventName: "text-change", handler: TextChangeHandler): EventEmitter;
  off(
    eventName: "selection-change",
    handler: SelectionChangeHandler
  ): EventEmitter;
  off(eventName: "editor-change", handler: EditorChangeHandler): EventEmitter;
  off(eventName: unknown, handler: unknown): EventEmitter {
    throw new Error("Method not implemented.");
  }
}
