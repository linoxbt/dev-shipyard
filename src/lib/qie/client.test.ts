import { describe, expect, it } from "bun:test";
import { loadIdentity, resolveNames, type IdentitySources } from "./client";

const word = (s: string) => Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
const num = (n: number) => n.toString(16).padStart(64, "0");
const registration = (labels: string[]) =>
  "0xbc96db3f" + labels.map((l) => num(3) + word("qie") + num(l.length) + word(l)).join("");

const WALLET = "0xAbC0000000000000000000000000000000000001";

/** The registrar's real call shape: offset to the order, isFree, then the order. */
const order = (isFree: boolean, label: string) =>
  "0xbc96db3f" +
  num(0x40) +
  num(isFree ? 1 : 0) +
  "8d4f87fcf811df24ca33bf4b68b3bbe4eee91e88".padStart(64, "0") +
  num(0x80) +
  num(0xc0) +
  num(0x100) +
  num(3) +
  word("qie") +
  num(label.length) +
  word(label) +
  num(3) +
  word("qie");

function sources(over: Partial<IdentitySources> = {}): IdentitySources {
  return {
    nameCount: async () => 1,
    tokenIds: async () => ["111"],
    mintTx: async () => "0xtx1",
    mintedIn: async () => ["111"],
    txInput: async () => registration(["oepeo3512"]),
    firstSeenAt: async () => Date.now() - 400 * 86_400_000,
    ...over,
  };
}

describe("resolveNames", () => {
  it("names a token the wallet owns from the registration that minted it", async () => {
    const names = await resolveNames(1, sources());
    expect(names).toHaveLength(1);
    expect(names[0].full).toBe("oepeo3512.qie");
    expect(names[0].confidence).toBe("exact");
  });

  it("shows a name received by transfer, not only names the wallet registered", async () => {
    // The registration minted to someone else; the contract says this wallet
    // owns the token now, which is what counts.
    const names = await resolveNames(
      1,
      sources({ mintTx: async () => "0xsomeone-elses-registration" }),
    );
    expect(names.map((n) => n.full)).toEqual(["oepeo3512.qie"]);
  });

  it("never names a token the wallet does not own", async () => {
    // A registration that minted two names to two wallets: only this wallet's
    // token may come back, even though both labels decode.
    const names = await resolveNames(
      1,
      sources({
        tokenIds: async () => ["2"],
        mintedIn: async () => ["1", "2"],
        txInput: async () => registration(["alice", "bob"]),
      }),
    );
    expect(names.map((n) => n.full)).toEqual(["bob.qie"]);
    expect(names[0].confidence).toBe("positional");
  });

  it("keeps the contract's order so the first name is the same for every viewer", async () => {
    const names = await resolveNames(
      2,
      sources({
        nameCount: async () => 2,
        tokenIds: async () => ["20", "10"],
        mintTx: async (id) => `0x${id}`,
        mintedIn: async (tx) => [tx.slice(2)],
        txInput: async (tx) => registration([tx === "0x20" ? "second" : "first"]),
      }),
    );
    expect(names.map((n) => n.full)).toEqual(["second.qie", "first.qie"]);
  });

  it("never shows a free name QIE handed out, only names somebody registered", async () => {
    // QIE's backend gives new wallets a random free name. That is a
    // placeholder, not the wallet's identity.
    const only = await loadIdentity(
      WALLET,
      sources({ txInput: async () => order(true, "ykhli97464") }),
    );
    expect(only.names).toEqual([]);
    expect(only.nameCount).toBe(0);

    const mixed = await loadIdentity(
      WALLET,
      sources({
        nameCount: async () => 2,
        tokenIds: async () => ["1", "2"],
        mintTx: async (id) => `0x${id}`,
        mintedIn: async (tx) => [tx.slice(2)],
        txInput: async (tx) => (tx === "0x1" ? order(true, "ykhli97464") : order(false, "qieidui")),
      }),
    );
    expect(mixed.names.map((n) => n.full)).toEqual(["qieidui.qie"]);
    expect(mixed.nameCount).toBe(1);
  });

  it("is empty, not broken, for a wallet with no names", async () => {
    expect(await resolveNames(0, sources())).toEqual([]);
    expect(await resolveNames(1, sources({ tokenIds: async () => [] }))).toEqual([]);
  });

  it("resolves registrations in parallel, not one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = () => new Promise((r) => setTimeout(r, 20));
    const ids = ["1", "2", "3", "4", "5", "6"];
    await resolveNames(6, {
      ...sources(),
      tokenIds: async () => ids,
      mintTx: async (id) => `0x${id}`,
      mintedIn: async (tx) => [tx.slice(2)],
      txInput: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await slow();
        inFlight--;
        return registration(["alice"]);
      },
    });
    expect(peak).toBe(6);
  });
});

describe("loadIdentity", () => {
  it("keeps the authoritative count even when the explorer fails", async () => {
    // balanceOf is exact; the labels are best effort. Losing the explorer must
    // not make a wallet look like it holds nothing.
    const id = await loadIdentity(
      WALLET,
      sources({
        nameCount: async () => 3,
        mintTx: async () => {
          throw new Error("explorer down");
        },
      }),
    );
    expect(id.nameCount).toBe(3);
    expect(id.names).toEqual([]);
  });

  it("computes wallet age from the first activity", async () => {
    const id = await loadIdentity(WALLET, sources());
    expect(id.walletAgeMs).toBeGreaterThan(390 * 86_400_000);
  });

  it("reports unknown age rather than zero when never seen", async () => {
    const id = await loadIdentity(WALLET, sources({ firstSeenAt: async () => null }));
    expect(id.walletAgeMs).toBeNull();
  });

  it("survives every source failing at once", async () => {
    const boom = async () => {
      throw new Error("nope");
    };
    const id = await loadIdentity(WALLET, {
      nameCount: boom,
      tokenIds: boom,
      mintTx: boom,
      mintedIn: boom,
      txInput: boom,
      firstSeenAt: boom,
    } as unknown as IdentitySources);
    expect(id.nameCount).toBe(0);
    expect(id.names).toEqual([]);
    expect(id.walletAgeMs).toBeNull();
  });
});
