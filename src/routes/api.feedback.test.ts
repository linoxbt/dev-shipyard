import { describe, expect, it } from "bun:test";
import { nps } from "./api.admin.feedback";

describe("feedback figures", () => {
  it("scores recommendation the usual way", () => {
    expect(nps([])).toBeNull();
    expect(nps([10, 9, 8, 7])).toBe(50);
    expect(nps([0, 6, 10, 10])).toBe(0);
    expect(nps([1, 2, 3])).toBe(-100);
  });
});
