// Copies sensitive text (seed phrases, private keys) and best-effort clears
// it from the clipboard again after a short window, so it doesn't sit there
// indefinitely readable by any other app on the device that polls the
// clipboard. Best-effort only: browsers without clipboard-read permission,
// or where the user copied something else in the meantime, just skip the
// clear silently — a mitigation, not a guarantee (there is no way to force
// a genuinely reliable auto-clear from a web page).
const AUTO_CLEAR_MS = 30_000;

export async function copySensitive(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === value) await navigator.clipboard.writeText("");
      } catch {
        /* no read permission, or the clipboard already changed — leave it */
      }
    })();
  }, AUTO_CLEAR_MS);
}
