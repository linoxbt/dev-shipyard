import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./orchestrator";
import type { ProviderMessage, ProviderUsage } from "./providers";
import { EMPTY_USAGE } from "./providers";

// Two files per session, because they answer two different questions.
//
// The .json is the resumable state: everything needed to pick the run back up,
// rewritten in full after every message. The .jsonl is the append-only record
// of what happened, which is what lets a second terminal tail a run it did not
// start. Rewriting the JSON on every message and appending to the JSONL costs
// a few milliseconds a turn and buys a crash in the middle of a long task
// being recoverable rather than lost.

export type SessionStatus = "running" | "finished" | "stopped" | "failed";

export interface SessionRecord {
  id: string;
  goal: string;
  root: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  steps: number;
  filesChanged: string[];
  usage: ProviderUsage;
  costUsd: number;
  summary: string;
  stoppedBecause: string;
  provider: string;
  model: string;
  messages: ProviderMessage[];
  /** A name given with /rename. */
  title?: string;
  /** Hidden from lists by /archive, still resumable by id. */
  archived?: boolean;
}

export const SESSIONS_DIR = join(".agent", "sessions");

export class SessionStore {
  readonly dir: string;

  constructor(readonly root: string) {
    this.dir = join(root, SESSIONS_DIR);
  }

  private ensure() {
    mkdirSync(this.dir, { recursive: true });
    // The agent's own bookkeeping must never end up in the user's history.
    // A checkpoint commits whatever changed, so without this the first one
    // sweeps the session files into their repo, and every turn after that
    // looks like it changed something. A self-ignoring directory keeps the
    // state out of git without touching the project's own .gitignore.
    const ignore = join(this.dir, "..", ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  }

  private jsonPath(id: string) {
    return join(this.dir, `${id}.json`);
  }

  private eventPath(id: string) {
    return join(this.dir, `${id}.jsonl`);
  }

  create(goal: string, meta: { provider: string; model: string }): SessionRecord {
    this.ensure();
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID().slice(0, 8),
      goal,
      root: this.root,
      createdAt: now,
      updatedAt: now,
      status: "running",
      steps: 0,
      filesChanged: [],
      usage: { ...EMPTY_USAGE },
      costUsd: 0,
      summary: "",
      stoppedBecause: "",
      provider: meta.provider,
      model: meta.model,
      messages: [],
    };
    this.save(record);
    return record;
  }

  /** Written through a temporary file and renamed, so a crash half way through
   *  a write leaves the previous session intact rather than a truncated file
   *  that will not parse on resume. */
  save(record: SessionRecord) {
    this.ensure();
    record.updatedAt = new Date().toISOString();
    const target = this.jsonPath(record.id);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2));
    renameSync(temporary, target);
  }

  load(id: string): SessionRecord | null {
    const path = this.jsonPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as SessionRecord;
    } catch {
      return null;
    }
  }

  list(options: { includeArchived?: boolean } = {}): SessionRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.load(name.slice(0, -".json".length)))
      .filter((record): record is SessionRecord => record !== null)
      .filter((record) => options.includeArchived || !record.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Deletes a session's state and its event log. Only ever a session id, so
   *  a crafted name cannot reach outside the sessions directory. */
  remove(id: string): boolean {
    if (!/^[0-9a-f]{8}$/.test(id)) return false;
    let removed = false;
    for (const path of [this.jsonPath(id), this.eventPath(id)]) {
      if (existsSync(path)) {
        rmSync(path);
        removed = true;
      }
    }
    return removed;
  }

  latest(): SessionRecord | null {
    return this.list()[0] ?? null;
  }

  appendEvent(id: string, event: AgentEvent) {
    this.ensure();
    appendFileSync(this.eventPath(id), `${JSON.stringify(event)}\n`);
  }

  /** Reads from a byte offset so a watcher can poll cheaply without re-reading
   *  the whole log, and returns the new offset to carry into the next call. */
  readEvents(id: string, fromByte = 0): { events: AgentEvent[]; offset: number } {
    const path = this.eventPath(id);
    if (!existsSync(path)) return { events: [], offset: 0 };
    const size = statSync(path).size;
    if (size <= fromByte) return { events: [], offset: size };
    const text = readFileSync(path, "utf8").slice(fromByte);
    const events: AgentEvent[] = [];
    let consumed = 0;
    for (const line of text.split("\n")) {
      // A partial final line means the writer is mid-append. Leave it for the
      // next poll rather than dropping the event.
      if (!text.slice(consumed).includes("\n")) break;
      consumed += line.length + 1;
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // A line that will not parse is skipped, not fatal.
      }
    }
    return { events, offset: fromByte + consumed };
  }
}
