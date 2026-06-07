import { create } from "zustand";

// One-shot hand-off used to push a ready-made prompt into the AI chat panel —
// e.g. the editor's "Fix with AI" action, which sends the compile errors plus
// the contract source. AiChat consumes the pending request on mount/change and
// auto-sends it. Mirrors editor-intake.ts (template → editor); kept in a store
// rather than props so any AiChat surface can pick it up without threading
// callbacks through the editor.
interface AiIntake {
  pending: string | null;
  request: (prompt: string) => void;
  consume: () => string | null;
}

export const useAiIntake = create<AiIntake>((set, get) => ({
  pending: null,
  request: (prompt) => set({ pending: prompt }),
  consume: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
}));
