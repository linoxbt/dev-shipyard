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

export interface LineSource {
  ask(prompt: string): Promise<string>;
  close(): void;
}

export function lineReader(rl: Interface, write: (text: string) => void): LineSource {
  const queued: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  let closed = false;

  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      queued.push(line);
    }
  });

  rl.on("close", () => {
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
      if (next !== undefined) return Promise.resolve(next);
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
  };
}
