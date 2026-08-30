import { describe, expect, it } from "bun:test";
import {
  deriveReputation,
  rankDeployers,
  reputationSummary,
  tierFor,
  type DeploymentLike,
} from "./reputation";

const d = (over: Partial<DeploymentLike> = {}): DeploymentLike => ({
  contractAddress: "0x1",
  templateId: "simple-erc20",
  projectName: "Token",
  network: "QIE Mainnet",
  deployedAt: 1_700_000_000_000,
  txHash: "0xabc",
  ...over,
});

describe("tierFor", () => {
  it("moves up with real deployments only", () => {
    expect(tierFor(0)).toBe("newcomer");
    expect(tierFor(3)).toBe("builder");
    expect(tierFor(10)).toBe("regular");
    expect(tierFor(25)).toBe("veteran");
  });
});

describe("deriveReputation", () => {
  it("counts breadth, not just volume", () => {
    const r = deriveReputation([
      d({ network: "QIE Mainnet", templateId: "simple-erc20" }),
      d({ network: "BOT Mainnet", templateId: "simple-staking" }),
      d({ network: "QIE Mainnet", templateId: "simple-erc20" }),
    ]);
    expect(r.deployments).toBe(3);
    expect(r.networks).toEqual(["BOT Mainnet", "QIE Mainnet"]);
    expect(r.templates).toEqual(["simple-erc20", "simple-staking"]);
    expect(r.tier).toBe("builder");
  });

  it("accepts bigint timestamps without NaN-ing the range", () => {
    // viem returns uint256 as bigint; treating it as a number would NaN the
    // whole date range.
    const r = deriveReputation([
      d({ deployedAt: 1_700_000_000_000n }),
      d({ deployedAt: 1_700_864_000_000n }),
    ]);
    expect(r.activeDays).toBe(10);
    expect(r.firstAt).toBe(1_700_000_000_000);
  });

  it("ignores zero timestamps rather than dating everyone to 1970", () => {
    const r = deriveReputation([d({ deployedAt: 0 }), d({ deployedAt: 1_700_000_000_000 })]);
    expect(r.firstAt).toBe(1_700_000_000_000);
    expect(r.activeDays).toBe(0);
  });

  it("handles a wallet with no history", () => {
    const r = deriveReputation([]);
    expect(r.deployments).toBe(0);
    expect(r.firstAt).toBeNull();
    expect(r.tier).toBe("newcomer");
    expect(reputationSummary(r)).toContain("No deployments");
  });
});

describe("reputationSummary", () => {
  it("reads as a sentence, not a stat dump", () => {
    const r = deriveReputation([
      d({ network: "QIE Mainnet", templateId: "a", deployedAt: 1_700_000_000_000 }),
      d({ network: "BOT Mainnet", templateId: "b", deployedAt: 1_700_864_000_000 }),
    ]);
    expect(reputationSummary(r)).toBe("2 deployments · 2 networks · 2 templates · active 10 days");
  });

  it("does not pluralise a single deployment", () => {
    expect(reputationSummary(deriveReputation([d()]))).toBe("1 deployment");
  });
});

describe("verification rate", () => {
  const at = (address: string): DeploymentLike => ({
    contractAddress: address,
    templateId: "erc20",
    projectName: "T",
    network: "qie-mainnet",
    deployedAt: 1_700_000_000_000,
    txHash: "0x1",
  });

  it("reports null when verification was never checked, not zero", () => {
    // "We do not know" and "none verified" are different claims about a person.
    expect(deriveReputation([at("0xAaA")]).verificationRate).toBeNull();
    expect(deriveReputation([at("0xAaA")], null).verificationRate).toBeNull();
  });

  it("counts verified contracts case-insensitively", () => {
    const r = deriveReputation([at("0xAaA"), at("0xBbB")], new Set(["0xaaa"]));
    expect(r.verified).toBe(1);
    expect(r.verificationRate).toBe(0.5);
  });

  it("is null rather than NaN when there are no deployments", () => {
    expect(deriveReputation([], new Set()).verificationRate).toBeNull();
  });
});

describe("rankDeployers", () => {
  it("ties share a rank and the next entry skips", () => {
    const rows = rankDeployers({
      "0x1111111111111111111111111111111111111111": 9,
      "0x2222222222222222222222222222222222222222": 9,
      "0x3333333333333333333333333333333333333333": 4,
      "0x4444444444444444444444444444444444444444": 20,
    });
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows[0].deployments).toBe(20);
  });

  it("drops malformed addresses and zero counts", () => {
    const rows = rankDeployers({
      "not-an-address": 5,
      "0x5555555555555555555555555555555555555555": 0,
      "0x6666666666666666666666666666666666666666": 2,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe("0x6666666666666666666666666666666666666666");
  });

  it("honours the limit", () => {
    const counts: Record<string, number> = {};
    for (let i = 1; i <= 60; i++) {
      counts[`0x${String(i).padStart(40, "0")}`] = i;
    }
    expect(rankDeployers(counts, 10)).toHaveLength(10);
  });
});

describe("template credit", () => {
  const dep = (address: string): DeploymentLike => ({
    contractAddress: address,
    templateId: "erc20",
    projectName: "T",
    network: "qie-mainnet",
    deployedAt: 1_700_000_000_000,
    txHash: "0x1",
  });

  it("defaults to zero when no template data is supplied", () => {
    const r = deriveReputation([dep("0x1")]);
    expect(r.templatesPublished).toBe(0);
    expect(r.templateDeploys).toBe(0);
  });

  it("counts published templates and their deploys", () => {
    const r = deriveReputation([dep("0x1")], null, { published: 3, deploys: 12 });
    expect(r.templatesPublished).toBe(3);
    expect(r.templateDeploys).toBe(12);
  });

  it("a template nobody deploys does not raise the tier", () => {
    // Publishing costs a transaction and proves nothing on its own.
    const unused = deriveReputation([dep("0x1")], null, { published: 40, deploys: 0 });
    expect(unused.tier).toBe(tierFor(1));
  });

  it("third-party use of your templates does raise the tier", () => {
    const bare = deriveReputation([dep("0x1")]);
    const authored = deriveReputation([dep("0x1")], null, { published: 2, deploys: 30 });
    expect(bare.tier).toBe("newcomer");
    expect(authored.tier).toBe("veteran");
  });

  it("summarises a pure template author who has deployed nothing", () => {
    const r = deriveReputation([], null, { published: 2, deploys: 5 });
    expect(reputationSummary(r)).toBe("2 templates published · used 5 times");
  });

  it("still reports nothing when there is genuinely nothing", () => {
    expect(reputationSummary(deriveReputation([]))).toBe("No deployments recorded on chain yet.");
  });
});
