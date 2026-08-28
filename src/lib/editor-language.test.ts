import { describe, expect, it } from "bun:test";
import { languageForPath } from "./editor-language";

describe("languageForPath", () => {
  it("keeps Solidity on our own Monarch grammar", () => {
    expect(languageForPath("contracts/Token.sol")).toBe("sol");
  });

  it("maps the file types a generated app is made of", () => {
    expect(languageForPath("app/index.html")).toBe("html");
    expect(languageForPath("app/app.js")).toBe("javascript");
    expect(languageForPath("app/styles.css")).toBe("css");
    expect(languageForPath("app/package.json")).toBe("json");
    expect(languageForPath("app/README.md")).toBe("markdown");
  });

  it("is case-insensitive on the extension", () => {
    expect(languageForPath("A.HTML")).toBe("html");
  });

  it("falls back to plaintext so an unknown file still opens", () => {
    // Returning undefined would leave Monaco unmounted — the old behaviour
    // this replaced showed "(not a .sol file)" and no editor at all.
    expect(languageForPath("LICENSE")).toBe("plaintext");
    expect(languageForPath("weird.xyz")).toBe("plaintext");
  });
});
