import { describe, expect, it } from "bun:test";
import { diagnose, dohSource, hostFor, type Lookup } from "./dns-check.server";

function fake(
  zone: string,
  table: Record<string, Partial<Record<"a" | "aaaa" | "cname" | "txt", string[]>>>,
): Lookup {
  const get = (k: "a" | "aaaa" | "cname" | "txt") => async (n: string) => table[n]?.[k] ?? [];
  return {
    a: get("a"),
    aaaa: get("aaaa"),
    cname: get("cname"),
    txt: get("txt"),
    zone: async () => zone,
  };
}

const proof = { name: "_devstation.useorion.xyz", value: "devstation-site=abc" };
const apex = [
  { type: "A", name: "useorion.xyz", host: "@", value: "76.76.21.21" },
  { type: "TXT", ...proof, host: "_devstation" },
];

describe("custom domain DNS", () => {
  it("names records the way DNS hosts ask for them", () => {
    expect(hostFor("useorion.xyz", "useorion.xyz")).toBe("@");
    expect(hostFor("_devstation.useorion.xyz", "useorion.xyz")).toBe("_devstation");
    expect(hostFor("_devstation.app.useorion.xyz.", "useorion.xyz")).toBe("_devstation.app");
  });

  it("passes records that are right", async () => {
    const d = await diagnose(
      "useorion.xyz",
      apex,
      proof,
      fake("useorion.xyz", {
        "useorion.xyz": { a: ["76.76.21.21"] },
        "_devstation.useorion.xyz": { txt: ["devstation-site=abc"] },
      }),
    );
    expect(d).toEqual({ owned: true, pointed: true, problems: [] });
  });

  it("finds the Namecheap parking record and a TXT record saved under a doubled name", async () => {
    const d = await diagnose(
      "useorion.xyz",
      apex,
      proof,
      fake("useorion.xyz", {
        "useorion.xyz": { a: ["162.255.119.121", "76.76.21.21"] },
        "_devstation.useorion.xyz.useorion.xyz": { txt: ["devstation-site=abc"] },
      }),
    );
    // The doubled name is still only something the domain's owner could make.
    expect(d.owned).toBe(true);
    expect(d.pointed).toBe(false);
    expect(d.problems).toHaveLength(1);
    expect(d.problems[0]).toContain("Remove the other A record for @ (162.255.119.121)");
  });

  it("says what is missing or wrong", async () => {
    const d = await diagnose(
      "useorion.xyz",
      apex,
      proof,
      fake("useorion.xyz", {
        "_devstation.useorion.xyz": { txt: ["devstation-site=old"] },
        "useorion.xyz": { aaaa: ["2001:db8::1"], a: ["1.2.3.4"] },
      }),
    );
    expect(d.owned).toBe(false);
    expect(d.problems.join(" ")).toContain("points to 1.2.3.4, not 76.76.21.21");
    expect(d.problems.join(" ")).toContain("Remove the AAAA record");
    expect(d.problems.join(" ")).toContain("has a different value");
  });

  it("checks a subdomain's CNAME, and tells a doubled Vercel TXT apart", async () => {
    const records = [
      { type: "CNAME", name: "app.example.com", host: "app", value: "cname.vercel-dns.com" },
      { type: "TXT", name: "_vercel.example.com", host: "_vercel", value: "vc-domain-verify=x" },
    ];
    const d = await diagnose(
      "app.example.com",
      records,
      { name: "_devstation.app.example.com", value: "y" },
      fake("example.com", {
        "app.example.com": { a: ["9.9.9.9"] },
        "_vercel.example.com.example.com": { txt: ["vc-domain-verify=x"] },
      }),
    );
    expect(d.pointed).toBe(false);
    expect(d.problems[0]).toContain("instead of a CNAME");
    expect(d.problems[1]).toContain("In the Host field put only _vercel");
  });

  it("reads DNS over HTTPS answers, long TXT values joined", async () => {
    const fetcher = (async () =>
      Response.json({
        Status: 0,
        Answer: [
          { type: 16, data: '"part one" "part two"' },
          { type: 5, data: "x." },
        ],
      })) as unknown as typeof fetch;
    expect(await dohSource("https://dns.test", fetcher)("x", "TXT")).toEqual(["part onepart two"]);
    const missing = (async () => Response.json({ Status: 3 })) as unknown as typeof fetch;
    expect(await dohSource("https://dns.test", missing)("x", "A")).toEqual([]);
  });
});
