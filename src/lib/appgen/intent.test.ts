import { describe, expect, it } from "bun:test";
import { parseIntent, parseStatusMarkers, projectSummary, stripStatusMarkers } from "./intent";

describe("parseIntent", () => {
  it("reads a conversational verdict and its answer", () => {
    const r = parseIntent(
      '{"mode":"converse","understanding":"a greeting","reply":"I am well. What shall we build?","needsClarification":false}',
    );
    expect(r?.mode).toBe("converse");
    expect(r?.reply).toBe("I am well. What shall we build?");
  });

  it("survives the model fencing its JSON", () => {
    const r = parseIntent('```json\n{"mode":"build","understanding":"wants a dashboard"}\n```');
    expect(r?.mode).toBe("build");
    expect(r?.understanding).toBe("wants a dashboard");
  });

  it("treats a converse verdict with NO reply as unusable", () => {
    // Rendering an empty assistant message is worse than the old behaviour, so
    // the caller must be able to fall back rather than show nothing.
    expect(parseIntent('{"mode":"converse","understanding":"hi"}')).toBeNull();
    expect(parseIntent('{"mode":"converse","reply":"   "}')).toBeNull();
  });

  it("returns null for anything unparseable, so the caller can fall back", () => {
    expect(parseIntent("I think you want an app.")).toBeNull();
    expect(parseIntent("")).toBeNull();
    expect(parseIntent("{ not json")).toBeNull();
  });

  it("defaults an unrecognised mode to converse rather than building", () => {
    // Building on a verdict nobody asked for is the failure this whole layer
    // exists to prevent.
    const r = parseIntent('{"mode":"launch_rockets","reply":"hello there"}');
    expect(r?.mode).toBe("converse");
  });
});

describe("parseStatusMarkers", () => {
  it("returns only CLOSED markers, so a half-arrived tag never renders", () => {
    const partial = '<status state="planning">Mapping the screens</status><status state="impl';
    const got = parseStatusMarkers(partial);
    expect(got).toHaveLength(1);
    expect(got[0].message).toBe("Mapping the screens");
    expect(got[0].state).toBe("planning");
  });

  it("keeps the model's order, which is how the UI shows progress", () => {
    const text =
      '<status state="inspecting">Reading the existing components</status>' +
      '<status state="implementing">Adding the dashboard route</status>';
    expect(parseStatusMarkers(text).map((m) => m.message)).toEqual([
      "Reading the existing components",
      "Adding the dashboard route",
    ]);
  });

  it("keeps a message under an unknown state rather than dropping it", () => {
    const got = parseStatusMarkers('<status state="hallucinating">Wiring the API</status>');
    expect(got).toHaveLength(1);
    expect(got[0].message).toBe("Wiring the API");
  });

  it("ignores an empty marker", () => {
    expect(parseStatusMarkers('<status state="planning">   </status>')).toHaveLength(0);
  });
});

describe("stripStatusMarkers", () => {
  it("removes markers from what the user reads", () => {
    const out = stripStatusMarkers(
      '<status state="planning">Mapping screens</status>\nI built the dashboard.',
    );
    expect(out).toBe("I built the dashboard.");
  });

  it("removes a marker the stream cut off mid-tag", () => {
    // Without this the user sees a dangling '<status state="imp' in the reply.
    const out = stripStatusMarkers('Done.\n<status state="implementing">still writ');
    expect(out).toBe("Done.");
  });
});

describe("projectSummary", () => {
  it("says plainly when nothing has been built", () => {
    // "Make the cards smaller" is a modification when files exist and a
    // question about intent when they do not.
    expect(projectSummary({})).toMatch(/no app yet/i);
  });

  it("lists what exists so a change can be judged against it", () => {
    const s = projectSummary({ "app/index.html": "x", "app/src/app.js": "y" });
    expect(s).toContain("2 file(s)");
    expect(s).toContain("app/src/app.js");
  });
});
