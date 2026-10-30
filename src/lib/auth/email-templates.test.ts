import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_TEMPLATES, functionTemplates } from "./email-templates";

const byFile = Object.fromEntries(EMAIL_TEMPLATES.map((t) => [t.file, t]));

describe("Supabase email templates", () => {
  test("sign-up and sign-in send a code, never a link", () => {
    for (const file of ["confirmation.html", "magic_link.html"]) {
      expect(byFile[file].html).toContain("{{ .Token }}");
      expect(byFile[file].html).not.toContain("{{ .ConfirmationURL }}");
    }
  });

  test("the emails with no code to type keep their link", () => {
    for (const file of ["invite.html", "email_change.html"]) {
      expect(byFile[file].html).toContain("{{ .ConfirmationURL }}");
    }
  });

  test("everything is inline: no stylesheet, no script", () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(t.html).not.toMatch(/<style|<link|<script/i);
      expect(t.html).toContain("DevStation Labs");
    }
  });

  test("the files in supabase/templates match (run bun scripts/email-templates.ts)", () => {
    const dir = join(import.meta.dir, "..", "..", "..", "supabase", "templates");
    for (const t of EMAIL_TEMPLATES) {
      expect(readFileSync(join(dir, t.file), "utf8")).toBe(t.html);
    }
    const fn = join(dir, "..", "functions", "send-code", "templates.ts");
    expect(readFileSync(fn, "utf8")).toBe(functionTemplates());
  });

  test("the code emails have a plain-text version with the code in it", () => {
    for (const file of ["confirmation.html", "magic_link.html"]) {
      expect(byFile[file].text).toContain("{{ .Token }}");
    }
  });
});
