import { create } from "zustand";

// One-shot hand-off used to open a Solidity source in the Contract Editor
// (e.g. "Open in Editor" from a template). The editor consumes it on mount and
// clears it. Kept in a tiny store rather than a query param so large source
// strings don't end up in the URL.
interface EditorIntake {
  pending: { filename: string; content: string } | null;
  setPending: (filename: string, content: string) => void;
  consume: () => { filename: string; content: string } | null;
}

export const useEditorIntake = create<EditorIntake>((set, get) => ({
  pending: null,
  setPending: (filename, content) => set({ pending: { filename, content } }),
  consume: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
}));
