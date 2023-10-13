import { Page } from "puppeteer";

export interface EditorUser {
  setup(): Promise<void>;

  /** length: default 0 */
  changeSelection(startDiff: number, length?: number): Promise<void>;

  /** minor for list: 1 = ordered, 2 = bullet. */
  toggleBlockFormat(major: "header" | "list", minor: 1 | 2): Promise<void>;
}

export class QuillUser implements EditorUser {
  constructor(readonly page: Page) {}

  async setup(): Promise<void> {
    // Select the Quill editor.
    await this.page.waitForSelector(".ql-editor");
    await this.page.click(".ql-editor");
  }

  async changeSelection(startDiff: number, length = 0): Promise<void> {
    await this.page.evaluate(`window.changeSelection(${startDiff}, ${length})`);
  }

  async toggleBlockFormat(
    major: "header" | "list",
    minor: 1 | 2
  ): Promise<void> {
    const cssClass = major === "header" ? "ql-header" : "ql-list";
    await this.page.click(`.${cssClass}:nth-child(${minor})`);
  }
}

export class GdocsUser implements EditorUser {
  constructor(readonly page: Page, readonly gdocsUrl: string) {}

  async setup(): Promise<void> {
    // Pretend we're a Chrome extension that wants access to the text.
    await this.page.evaluateOnNewDocument(
      `window._docs_annotate_canvas_by_ext = 'klbcgckkldhdhonijdbnhhaiedfkllef';`
    );
    await this.page.goto(this.gdocsUrl);

    // Inject code that outputs sigils.
    await this.page.waitForSelector(".kix-rotatingtilemanager-content");
    await this.page.evaluate(
      `
const seenSigils = new Set();

function onTextChange(before, after) {
  // console.log("Text change:", before,",", after);

  // 1. To reduce false positives from edits inside on old sigil,
  // ensure the number of @s increased.
  const beforeAts = before.match(/@/g)?.length ?? 0;
  const afterAts = after.match(/@/g)?.length ?? 0;
  if (afterAts <= beforeAts) return;

  // 2. Output globally-new sigils.
  const afterSigils = sigils(after);
  for (const sigil of afterSigils) {
    if (!seenSigils.has(sigil)) {
      console.log("S:n," + sigil);
      seenSigils.add(sigil);
    }
  }
}
      
function sigils(str) {
  const ans = new Set();
  let index = str.indexOf("@");
  while (index !== -1) {
    if (index >= 4) {
      const sigil = str.slice(index - 4, index);
      // Ignore definitely-interleaved sigils that will confuse the client.
      if (!(sigil.includes("\\n") || sigil.includes(","))) {
        ans.add(sigil);
      }
    }
    index = str.indexOf("@", index + 1);
  }
  return ans;
}

function onMutation(mutationList) {
  for (const mutation of mutationList) {
    // console.log(mutation);
    if (mutation.addedNodes.length === 0) {
      // No new text.
      continue;
    }
    let after = "";
    for (const added of mutation.addedNodes) {
      after += added.ariaLabel ?? "";
    }

    if (mutation.removedNodes.length === 0) {
      // When scrolling makes old text appear, we end up in this case.
      // To prevent claiming that the old text was just received now (giving
      // very high latency), mark the added sigils as "seen" without logging them.
      for (const sigil of sigils(after)) seenSigils.add(sigil);
      continue;
    }
    let before = "";
    for (const removed of mutation.removedNodes) {
      before += removed.ariaLabel ?? "";
    }

    if (after === before) continue;
    onTextChange(before, after);
  }
}

const contentRoot = document.querySelector(".kix-rotatingtilemanager-content");
if (contentRoot === null) {
  console.error("contentRoot not found");
} else {
  new MutationObserver(onMutation).observe(
    contentRoot,
    {subtree: true, childList: true}
  );
}
`
    );

    // Select the Gdocs editor.
    await this.page.waitForSelector(".kix-canvas-tile-content");
    await this.page.click(".kix-canvas-tile-content");
  }

  async changeSelection(startDiff: number, length = 0): Promise<void> {
    // Instead of moving the cursor programmatically like for Quill,
    // we approximate using the keyboard.
    if (startDiff !== 0) {
      const diffAbs = Math.abs(startDiff);
      const diffRight = startDiff >= 0;
      if (diffAbs <= 5) {
        for (let i = 0; i < diffAbs; i++) {
          await this.page.keyboard.press(
            diffRight ? "ArrowRight" : "ArrowLeft"
          );
        }
      } else if (diffAbs <= 500) {
        for (let i = 0; i < diffAbs / 100; i++) {
          await this.page.keyboard.press(diffRight ? "ArrowDown" : "ArrowUp");
        }
      } else {
        await this.page.keyboard.press(diffRight ? "PageDown" : "PageUp");
      }
    }
  }

  async toggleBlockFormat(
    major: "header" | "list",
    minor: 1 | 2
  ): Promise<void> {
    if (major === "header") {
      // Ignore for now - headers are not compatible with sigil measurements.
      // (Don't see later edits in a header; toggling a header refreshes
      // all following aria-label nodes.)
      //
      // // Shortcut: Ctrl+Alt+ 1 or 2.
      // const char = minor === 1 ? "1" : "2";
      // await this.page.keyboard.down("Control");
      // await this.page.keyboard.down("Alt");
      // await this.page.keyboard.type(char);
      // await this.page.keyboard.up("Alt");
      // await this.page.keyboard.up("Control");
    } else {
      // Shortcut: Ctrl+Shift+ 7 or 8.
      const char = minor === 1 ? "8" : "7";
      await this.page.keyboard.down("Control");
      await this.page.keyboard.down("Shift");
      await this.page.keyboard.type(char);
      await this.page.keyboard.up("Shift");
      await this.page.keyboard.up("Control");
    }
  }
}
