// Writes DevStation's Supabase email templates to supabase/templates/.
// Run after changing src/lib/auth/email-templates.ts:
//
//   bun scripts/email-templates.ts
//
// then put each file in the Supabase dashboard (supabase/README.md).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_TEMPLATES } from "../src/lib/auth/email-templates";

const root = join(import.meta.dir, "..", "supabase");

const dir = join(root, "templates");
mkdirSync(dir, { recursive: true });
for (const t of EMAIL_TEMPLATES) {
  writeFileSync(join(dir, t.file), t.html);
  console.log(`templates/${t.file}  (${t.name}: "${t.subject}")`);
}
