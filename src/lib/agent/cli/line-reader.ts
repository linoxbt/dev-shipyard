import type { Interface } from "node:readline/promises";

// Why this exists rather than calling readline.question() in a loop.
//
// question() only listens while it is being awaited. A session spends most of
// its time not awaiting: it is running a turn that takes a minute. Lines that
// arrive in that window are emitted and dropped, and when the input is a pipe
// the stream reaches its end and readline closes itself, so the next question()
// rejects with "readline was closed" and the session ends after one turn with
// its remaining instructions unread.
//
// Queuing every line as it arrives means input that turns up mid-turn is still
// there when the next prompt comes round, and end-of-input becomes an ordinary
// "nothing more to read" rather than an error.
//
// Pasting is the other half. A terminal hands a pasted brief over as separate
// lines, all within a millisecond or two. Read one at a time, the first line
// became a whole message ("Build GenContract", with the spec that followed it
// arriving as a dozen more), and a blank line in the middle read as the end of
// the input and closed the session. At a terminal, lines that arrive in one
// burst are one message, and a multi-line paste waits for Enter so the last
// line, which the terminal only sends when Enter is pressed, joins it.

export interface LineSource {
  ask(prompt: string): Promise<string>;
  close(): void;
  /** True once the input has closed and everything it sent has been read. An
   *  empty line from a person pressing Enter is not the end of anything. */
  ended(): boolean;
  /** Whether a prompt is currently waiting for a line. */
  waiting(): boolean;
  /** Ignore lines until the returned function is called: while an arrow-key
   *  picker has the keyboard, its Enter is not a message. */
  hold(): () => void;
  /** What is waiting to be sent: a held paste, and how many lines it has. */
  pending(): { text: string; pastedLines: number };
}

export interface LineReaderOptions {
  /** Lines arriving within this many milliseconds of each other are one
   *  message. 0 reads line by line, which is right for a pipe. */
  coalesceMs?: number;
  /** Told when a multi-line paste is being held for Enter. */
  onPasteHeld?: (lines: number) => void;
  /** Told when a message is handed to whoever asked for it, so a terminal can
   *  draw it as sent. Not called for the empty line a closed input gives. */
  onDeliver?: (text: string) => void;
}

export function lineReader(
  rl: Interface,
  write: (text: string) => void,
  opts: LineReaderOptions = {},
): LineSource {
  const coalesceMs = opts.coalesceMs ?? 0;
  const queued: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  let closed = false;
  let burst: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** A multi-line paste, waiting for the Enter that sends it. */
  let held: string | null = null;
  let holds = 0;

  const deliver = (text: string) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      opts.onDeliver?.(text);
      resolve(text);
    } else {
      queued.push(text);
    }
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (burst.length === 0) return;
    const lines = burst;
    burst = [];

    if (lines.length > 1) {
      // A paste. Hold it: its last line is still in the terminal's edit buffer
      // unless the paste happened to end with a newline.
      held = held === null ? lines.join("\n") : `${held}\n${lines.join("\n")}`;
      opts.onPasteHeld?.(held.split("\n").length);
      return;
    }

    const [line] = lines;
    if (held !== null) {
      const text = line ? `${held}\n${line}` : held;
      held = null;
      deliver(text);
      return;
    }
    deliver(line);
  };

  rl.on("line", (line) => {
    if (holds > 0) return;
    if (coalesceMs <= 0) {
      deliver(line);
      return;
    }
    burst.push(line);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, coalesceMs);
  });

  rl.on("close", () => {
    flush();
    if (held !== null) {
      deliver(held);
      held = null;
    }
    closed = true;
    // Anything already queued still gets read; only a waiter with nothing left
    // to give is released with an empty line, which callers treat as the end.
    if (waiting && queued.length === 0) {
      const resolve = waiting;
      waiting = null;
      resolve("");
    }
  });

  return {
    ask(prompt: string): Promise<string> {
      const next = queued.shift();
      if (next !== undefined) {
        opts.onDeliver?.(next);
        return Promise.resolve(next);
      }
      if (closed) return Promise.resolve("");
      write(prompt);
      return new Promise<string>((resolve) => {
        waiting = resolve;
      });
    },
    close() {
      closed = true;
      rl.close();
    },
    ended() {
      return closed && queued.length === 0 && burst.length === 0 && held === null;
    },
    waiting() {
      return waiting !== null;
    },
    pending() {
      const parts = [...(held === null ? [] : [held]), ...burst];
      return { text: parts.join("\n"), pastedLines: held === null ? 0 : held.split("\n").length };
    },
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
      };
    },
  };
}
