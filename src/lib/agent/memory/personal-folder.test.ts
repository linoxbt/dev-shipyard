import { describe, expect, it } from "bun:test";
import { isPersonalFolder } from "./workspace-index";

// Desktop is where people keep keys, notes and unrelated projects side by
// side. Indexing it put all of that in front of the model on "hello".

describe("folders that are not one project", () => {
  it("covers home and the folders people dump things in", () => {
    expect(isPersonalFolder("/home/me", "/home/me", "linux")).toBe(true);
    expect(isPersonalFolder("/home/me/Desktop/", "/home/me", "linux")).toBe(true);
    expect(isPersonalFolder("/home/me/Downloads", "/home/me", "linux")).toBe(true);
    expect(isPersonalFolder("/home/me/Desktop/app", "/home/me", "linux")).toBe(false);
    expect(isPersonalFolder("/srv/app", "/home/me", "linux")).toBe(false);
  });

  it("matches Windows and Git Bash spellings of the same folder", () => {
    const home = "/c/Users/LINO ALEMZ";
    expect(isPersonalFolder("C:\\Users\\LINO ALEMZ\\Desktop", home, "win32")).toBe(true);
    expect(isPersonalFolder("c:\\users\\lino alemz", "C:\\Users\\LINO ALEMZ", "win32")).toBe(true);
    expect(isPersonalFolder("C:\\Users\\LINO ALEMZ\\Desktop\\site", home, "win32")).toBe(false);
  });
});
