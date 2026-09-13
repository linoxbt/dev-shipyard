import { describe, expect, it } from "bun:test";
import { APPROVAL_CHOICES, PLAN_CHOICES, pickerKey, renderPicker } from "./picker";

describe("choosing with the arrow keys", () => {
  it("moves the marker with up and down, wrapping at the ends", () => {
    expect(pickerKey({ name: "down" }, 0, APPROVAL_CHOICES)).toEqual({ selected: 1 });
    expect(pickerKey({ name: "up" }, 0, APPROVAL_CHOICES)).toEqual({ selected: 2 });
    expect(pickerKey({ name: "down" }, 2, APPROVAL_CHOICES)).toEqual({ selected: 0 });
  });

  it("confirms the marked option with Enter", () => {
    expect(pickerKey({ name: "return" }, 1, APPROVAL_CHOICES)).toEqual({ selected: 1, done: 1 });
  });

  it("picks straight away by number or letter", () => {
    expect(pickerKey({ sequence: "3" }, 0, APPROVAL_CHOICES).done).toBe(2);
    expect(pickerKey({ sequence: "a" }, 0, APPROVAL_CHOICES).done).toBe(1);
    expect(pickerKey({ sequence: "Y" }, 2, APPROVAL_CHOICES).done).toBe(0);
    expect(pickerKey({ sequence: "7" }, 0, APPROVAL_CHOICES).done).toBeUndefined();
  });

  it("declines with Esc or Ctrl-C, whichever option is marked", () => {
    expect(pickerKey({ name: "escape" }, 0, APPROVAL_CHOICES).done).toBe(2);
    expect(pickerKey({ name: "c", ctrl: true }, 0, PLAN_CHOICES).done).toBe(1);
  });

  it("draws the marker on the selected option, with how to use it", () => {
    const lines = renderPicker(APPROVAL_CHOICES, 1);
    expect(lines[0]).toBe("  1. Yes, proceed (y)");
    expect(lines[1]).toBe("› 2. Yes, and don't ask again this session (a)");
    expect(lines[3]).toContain("↑/↓ to choose");
  });
});
