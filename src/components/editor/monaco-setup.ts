// Monaco from DevStation's own bundle instead of a CDN.
//
// @monaco-editor/react's default loader pulls Monaco at runtime from
// cdn.jsdelivr.net into DevStation's own origin, with no integrity check: a
// compromised or hijacked CDN response would run as DevStation, next to the
// wallet. The `monaco-editor` package was already a dependency (used only for
// types), so the editor is now loaded from it: the same version, shipped and
// hashed with the rest of the build.
//
// Client-only and lazy: imported from an effect, so neither the server render
// nor any page without an editor pays for Monaco.

import { loader } from "@monaco-editor/react";

let ready: Promise<void> | null = null;

export function ensureLocalMonaco(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const [monaco, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    ]);
    // Language services run in workers built from the same package, so no
    // worker script is fetched from anywhere else either.
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_id: string, label: string) {
        if (label === "json") return new jsonWorker.default();
        if (label === "css" || label === "scss" || label === "less") return new cssWorker.default();
        if (label === "html" || label === "handlebars" || label === "razor") {
          return new htmlWorker.default();
        }
        if (label === "typescript" || label === "javascript") return new tsWorker.default();
        return new editorWorker.default();
      },
    };
    loader.config({ monaco });
  })();
  // A failed load can be retried on the next mount.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
