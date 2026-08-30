import { describe, expect, it } from "bun:test";
import { loadIdentity, resolveNames, type IdentitySources } from "./client";

const word = (s: string) => Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
const num = (n: number) => n.toString(16).padStart(64, "0");
const registration = (labels: string[]) =>
  "0xbc96db3f" + labels.map((l) => num(3) + word("qie") + num(l.length) + word(l)).join("");

const WALLET = "0xAbC0000000000000000000000000000000000001";

function sources(over: Partial<IdentitySources> = {}): IdentitySources {
  return {
    nameCount: async () => 1,
    transfers: async () => [{ txHash: "0xtx1", tokenId: "111" }],
    txInput: async () => registration(["oepeo3512"]),
    ownerOf: async () => WALLET,
    firstSeenAt: async () => Date.now() - 400 * 86_400_000,
    ...over,
  };
}

describe("resolveNames", () => {
  it("returns a name only when the wallet still owns its token", async () => {
    const names = await resolveNames(WALLET, sources());
    expect(names).toHaveLength(1);
    expect(names[0].full).toBe("oepeo3512.qie");
    expect(names[0].confidence).toBe("exact");
  });

  it("drops a name the wallet has sold", async () => {
    // Otherwise a profile would keep asserting an identity its owner gave away.
    const names = await resolveNames(
      WALLET,
      sources({ ownerOf: async () => "0x9999999999999999999999999999999999999999" }),
    );
    expect(names).toEqual([]);
  });

  it("matches ownership case-insensitively", async () => {
    // Explorers and RPCs disagree on address casing; a checksum mismatch must
    // not silently hide someone's name.
    const names = await resolveNames(
      WALLET.toLowerCase(),
      sources({ ownerOf: async () => WALLET.toUpperCase() }),
    );
    expect(names).toHaveLength(1);
  });

  it("groups several names minted in one registration", async () => {
    const names = await resolveNames(
      WALLET,
      sources({
        transfers: async () => [
          { txHash: "0xtx1", tokenId: "1" },
          { txHash: "0xtx1", tokenId: "2" },
        ],
        txInput: async () => registration(["alice", "bob"]),
      }),
    );
    expect(names.map((n) => n.full)).toEqual(["alice.qie", "bob.qie"]);
    expect(names.every((n) => n.confidence === "positional")).toBe(true);
  });

  it("is empty, not broken, for a wallet with no names", async () => {
    expect(await resolveNames(WALLET, sources({ transfers: async () => [] }))).toEqual([]);
  });
});

describe("loadIdentity", () => {
  it("keeps the authoritative count even when indexing fails", async () => {
    // balanceOf is exact; the labels are best effort. Losing the explorer must
    // not make a wallet look like it holds nothing.
    const id = await loadIdentity(
      WALLET,
      sources({
        nameCount: async () => 3,
        transfers: async () => {
          throw new Error("explorer down");
        },
      }),
    );
    expect(id.nameCount).toBe(3);
    expect(id.names).toEqual([]);
  });

  it("computes wallet age from the first transaction", async () => {
    const id = await loadIdentity(WALLET, sources());
    expect(id.walletAgeMs).toBeGreaterThan(390 * 86_400_000);
  });

  it("reports unknown age rather than zero when never seen", async () => {
    const id = await loadIdentity(WALLET, sources({ firstSeenAt: async () => null }));
    expect(id.walletAgeMs).toBeNull();
  });

  it("never populates pass state passively", async () => {
    // A verification request notifies a real person and asks for consent. It
    // must only ever happen when they press the button.
    const id = await loadIdentity(WALLET, sources());
    expect(id.pass).toBeNull();
  });

  it("survives every source failing at once", async () => {
    const boom = async () => {
      throw new Error("nope");
    };
    const id = await loadIdentity(WALLET, {
      nameCount: boom,
      transfers: boom,
      txInput: boom,
      ownerOf: boom,
      firstSeenAt: boom,
    } as unknown as IdentitySources);
    expect(id.nameCount).toBe(0);
    expect(id.names).toEqual([]);
    expect(id.walletAgeMs).toBeNull();
  });
});

describe("resolution is parallel, not serial", () => {
  it("does not chain one request after another", async () => {
    // Serially, a dozen names meant roughly two dozen round-trips and five to
    // ten seconds before anything appeared. This asserts the shape, not the
    // clock: all the txInput calls must be in flight before any resolves.
    let concurrentInputs = 0;
    let peakInputs = 0;
    const slow = () => new Promise((r) => setTimeout(r, 20));

    const transfers = Array.from({ length: 6 }, (_, i) => ({
      txHash: `0xtx${i}`,
      tokenId: String(i),
    }));

    await resolveNames(WALLET, {
      nameCount: async () => 6,
      transfers: async () => transfers,
      txInput: async () => {
        concurrentInputs++;
        peakInputs = Math.max(peakInputs, concurrentInputs);
        await slow();
        concurrentInputs--;
        return registration(["alice"]);
      },
      ownerOf: async () => WALLET,
      firstSeenAt: async () => null,
    });

    expect(peakInputs).toBe(6);
  });

  it("still verifies ownership for every candidate", async () => {
    // Parallelising must not skip the check that makes a name trustworthy.
    let ownerChecks = 0;
    const names = await resolveNames(WALLET, {
      nameCount: async () => 2,
      transfers: async () => [
        { txHash: "0xa", tokenId: "1" },
        { txHash: "0xb", tokenId: "2" },
      ],
      txInput: async () => registration(["alice"]),
      ownerOf: async () => {
        ownerChecks++;
        return WALLET;
      },
      firstSeenAt: async () => null,
    });
    expect(ownerChecks).toBe(2);
    expect(names).toHaveLength(2);
  });
});
