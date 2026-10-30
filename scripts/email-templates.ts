// Writes DevStation's email templates where they are used. Run after changing
// src/lib/auth/email-templates.ts:
//
//   bun scripts/email-templates.ts
//
// - supabase/functions/send-code/templates.ts: the sign-up and sign-in code
//   emails, which our edge function sends (redeploy the function after).
// - supabase/templates/*.html: every template as HTML, for the emails Supabase
//   sends itself (supabase/README.md).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_TEMPLATES, functionTemplates } from "../src/lib/auth/email-templates";

const root = join(import.meta.dir, "..", "supabase");

const dir = join(root, "templates");
mkdirSync(dir, { recursive: true });
for (const t of EMAIL_TEMPLATES) {
  writeFileSync(join(dir, t.file), t.html);
  console.log(`templates/${t.file}  (${t.name}: "${t.subject}")`);
}

writeFileSync(join(root, "functions", "send-code", "templates.ts"), functionTemplates());
console.log("functions/send-code/templates.ts");
