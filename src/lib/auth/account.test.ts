import { describe, expect, it } from "bun:test";
import { accountAddressOf } from "./account";
import { accountAddress } from "./account.server";

describe("account ids", () => {
  it("are the same for an email however it is written, and look like an address", async () => {
    const a = accountAddress("Denis@Example.com ");
    expect(a).toBe(accountAddress("denis@example.com"));
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(accountAddress("other@example.com")).not.toBe(a);
  });

  it("agree between the server and the browser", async () => {
    expect(await accountAddressOf("Denis@Example.com")).toBe(accountAddress("denis@example.com"));
  });
});
