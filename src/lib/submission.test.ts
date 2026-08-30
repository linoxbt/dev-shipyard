import { describe, expect, it } from "bun:test";
import { generateSubmission, isSubmissionComplete, type SubmissionEntry } from "./submission";

const e = (over: Partial<SubmissionEntry> = {}): SubmissionEntry => ({
  contractAddress: "0xabc",
  templateId: "simple-erc20",
  projectName: "My Token",
  network: "QIE Mainnet",
  deployedAt: 1_700_000_000_000,
  txHash: "0xtx",
  ...over,
});

describe("generateSubmission", () => {
  it("reports the whole footprint, not just one contract", () => {
    const out = generateSubmission({
      projectName: "Thing",
      developer: "0xdev",
      entries: [
        e({ network: "QIE Mainnet", verified: true }),
        e({ network: "BOT Mainnet", contractAddress: "0xdef" }),
      ],
    });
    expect(out).toContain("Deployments: 2");
    expect(out).toContain("BOT Mainnet, QIE Mainnet");
    expect(out).toContain("Verified contracts: 1 of 2");
    expect(out).toContain("0xabc");
    expect(out).toContain("0xdef");
  });

  it("includes explorer links a judge can open", () => {
    const out = generateSubmission({
      projectName: "T",
      developer: "0xdev",
      entries: [e({ explorerUrl: "https://mainnet.qie.digital/address/0xabc" })],
    });
    expect(out).toContain("https://mainnet.qie.digital/address/0xabc");
  });

  it("is honest when there is nothing deployed", () => {
    const out = generateSubmission({ projectName: "T", developer: "0xdev", entries: [] });
    expect(out).toContain("No deployments recorded on chain yet");
    expect(out).toContain("Deployments: 0");
  });

  it("leaves visible prompts rather than silently omitting fields", () => {
    // A submission with "<add your repo URL>" still in it is obviously
    // unfinished. One that quietly drops the field is not.
    const out = generateSubmission({ projectName: "T", developer: "0xdev", entries: [e()] });
    expect(out).toContain("<add your repo URL>");
    expect(isSubmissionComplete(out)).toBe(false);
  });

  it("reports complete once the prompts are filled", () => {
    const out = generateSubmission({
      projectName: "T",
      developer: "0xdev",
      entries: [e()],
      repoUrl: "https://github.com/x/y",
      demoUrl: "https://demo.example",
      description: "A thing that does a thing.",
    });
    expect(isSubmissionComplete(out)).toBe(true);
  });
});
