import { Page } from "puppeteer";
import seedrandom from "seedrandom";
import { EditorUser } from "../editor_user";
const { edits } = require("../editing_trace") as {
  edits: ([number, 0, string] | [number, 1])[];
};

/**
 * 6 keys/second (~60 wpm) - average typing speed.
 *
 * This is the attempted loop interval, i.e., we sleep to make
 * this the time between *starts* of consecutive loop iterations
 * (not end -> start). But if a loop iteration takes longer than this,
 * we just sleep for 0 ms.
 */
const TYPING_INTERVAL_MS = 167;

// Attempt a sigil every 10 seconds' worth of edits.
const SIGIL_FREQ = Math.round(10000 / TYPING_INTERVAL_MS);
// Length of the sigil (less ending @).
const SIGIL_LENGTH = 4;
const SIGIL_END = "@";

// The derived odds that an op is part of a sigil, which is
// always a text insert.
const SIGIL_ODDS = (SIGIL_LENGTH + 1) / SIGIL_FREQ;
const FORMAT_CURSOR_ODDS = 0.005;
const FORMAT_RANGE_ODDS = 0.0025;
const FORMAT_BLOCK_ODDS = 0.0025;

// Max distance between format range start and the cursor
// (may wrap around). Uniform random +/-.
const FORMAT_RANGE_DIST = 50;
// Max length of a format range (may run into end). Uniform random.
const FORMAT_RANGE_LENGTH = 50;

/**
 * All Active scenario: all users type all the time.
 */
export async function allActive(
  page: Page,
  editorUser: EditorUser,
  numUsers: number,
  userID: number
) {
  const rng = seedrandom("42_" + userID);

  // Locate assigned range of edits for the given user.
  const numOpersPerUser = Math.floor(edits.length / numUsers);
  const startIndex = userID * numOpersPerUser;
  let endIndex = (userID + 1) * numOpersPerUser;
  if (userID == numUsers - 1) {
    endIndex = edits.length;
  }
  const ourEdits = edits.slice(startIndex, endIndex);

  // Set the loop var i to start staggered in (SIGIL_LENGTH, SIGIL_FREQ].
  // That way we don't get perf artifacts from everyone sending & measuring
  // sigils at once.
  const cycleLessSigilLength = SIGIL_FREQ - SIGIL_LENGTH;
  let i =
    SIGIL_LENGTH + 1 + Math.floor((cycleLessSigilLength * userID) / numUsers);

  let editIndex = 0;
  let sigil = "";
  /**
   * The simulated cursor position *relative to the trace ops*,
   * pretending that other users don't exist.
   */
  let cursorPos = 0;
  for (; ; i++) {
    const startTime = Date.now();

    const cycleI = i % SIGIL_FREQ;
    if (cycleI <= SIGIL_LENGTH) {
      // Do a sigil op.
      if (cycleI === 0) {
        // First 2 sigil chars are userID, second two are a count for our sigils
        // (base 36).
        const sigilCounter = Math.floor(i / SIGIL_FREQ) % (36 * 36);
        const sigilNum = 36 * 36 * userID + sigilCounter;
        sigil = sigilNum.toString(36).padStart(4, "0");
      }
      if (cycleI === SIGIL_LENGTH) {
        // Log when we *start* sending SIGIL_END.
        // Latency is the time from now until the Quill text-change event
        // sees SIGIL_END.
        console.log(
          JSON.stringify({ type: "sigilSend", time: Date.now(), sigil })
        );
      }

      // Type sigil[cycleI].
      await page.keyboard.type(
        cycleI === SIGIL_LENGTH ? SIGIL_END : sigil[cycleI]
      );
    } else {
      switch (randomOp(rng)) {
        case "trace": {
          // Perform an op from the editing trace.
          const [index, oper, char] = ourEdits[editIndex];
          const opCursorPos = index + oper;

          // Move the cursor if necessary.
          // We move it relative to the previous cursorPos using changeSelection,
          // to increase the chance that we stay within "our" region of the doc.
          // (However, it is still not true to the original doc due to sigils.)
          if (opCursorPos !== cursorPos) {
            await editorUser.changeSelection(opCursorPos - cursorPos);
            cursorPos = opCursorPos;
          }

          // Perform edit.
          if (oper == 0) {
            await page.keyboard.type(char);
            cursorPos++;
          } else if (oper == 1) {
            await page.keyboard.press("Backspace");
            cursorPos--;
          }

          editIndex = (editIndex + 1) % ourEdits.length;
          break;
        }
        case "format_cursor": {
          // Change the inline format under the cursor using Ctrl+(b|i).
          await inlineFormatKeyCombo(page, rng);
          break;
        }
        case "format_range": {
          // Change the inline format of a short range of text.
          const startDiff =
            -FORMAT_RANGE_DIST +
            Math.floor(rng() * (2 * FORMAT_RANGE_DIST + 1));
          const length = 1 + Math.floor(rng() * FORMAT_RANGE_LENGTH);
          await editorUser.changeSelection(startDiff, length);
          await inlineFormatKeyCombo(page, rng);

          // Move cursor back.
          await editorUser.changeSelection(-startDiff);
          break;
        }
        case "format_block": {
          // Change the current block's formatting by pressing a toolbar button.
          // 4 options: header 1, header 2, ordered list, bullet list.
          const major = ["header", "list"][Math.floor(rng() * 2)] as
            | "header"
            | "list";
          const minor = (1 + Math.floor(rng() * 2)) as 1 | 2;
          await editorUser.toggleBlockFormat(major, minor);
        }
      }
    }

    // Sleep so the next iteration starts at (startTime + TYPING_INTERVAL_MS),
    // if possible.
    const toSleep = Math.max(0, startTime + TYPING_INTERVAL_MS - Date.now());
    await new Promise((resolve) => setTimeout(resolve, toSleep));
  }
}

function randomOp(rng: seedrandom.prng) {
  // To ensure that our odds are accurate, we must account for the fraction
  // of ops that are sigil inserts.
  let randomizer = rng() * (1 - SIGIL_ODDS);

  if (randomizer < FORMAT_CURSOR_ODDS) return "format_cursor";
  randomizer -= FORMAT_CURSOR_ODDS;
  if (randomizer < FORMAT_RANGE_ODDS) return "format_range";
  randomizer -= FORMAT_RANGE_ODDS;
  if (randomizer < FORMAT_BLOCK_ODDS) return "format_block";
  return "trace";
}

async function inlineFormatKeyCombo(page: Page, rng: seedrandom.prng) {
  const char = ["b", "i"][Math.floor(rng() * 2)];
  await page.keyboard.down("Control");
  await page.keyboard.type(char);
  await page.keyboard.up("Control");
}
