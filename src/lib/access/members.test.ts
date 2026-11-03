import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { admit, isMember, forgetMember } from "./members.server";

// Against a stand-in database: what sign-in does with each answer, and that
// a database that cannot answer never locks people out.

const OWNER = `0x${"a".repeat(40)}`;
const ADMIN_EMAIL = "boss@example.com";

describe("admission", () => {
  let server: ReturnType<typeof Bun.serve>;
  let answer: () => Response = () => Response.json({ status: "member" });
  let memberRows: unknown[] = [];
  const calls: string[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        calls.push(url.pathname);
        if (url.pathname === "/rest/v1/rpc/admit_account") return answer();
        if (url.pathname === "/rest/v1/platform_members") return Response.json(memberRows);
        return Response.json([]);
      },
    });
    for (const k of ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_EMAILS"]) {
      saved[k] = process.env[k];
    }
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  });

  afterAll(() => {
    server.stop(true);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("lets members and newly admitted accounts in, and says a waitlisted one's place", async () => {
    answer = () => Response.json({ status: "member" });
    expect(await admit(OWNER, "a@example.com")).toEqual({ status: "member" });
    answer = () => Response.json({ status: "admitted" });
    expect(await admit(OWNER, "a@example.com")).toEqual({ status: "admitted" });
    answer = () => Response.json({ status: "waitlisted", place: 7 });
    expect(await admit(OWNER, "a@example.com")).toEqual({ status: "waitlisted", place: 7 });
  });

  it("never locks anyone out when the database cannot answer", async () => {
    answer = () => new Response("down", { status: 500 });
    expect((await admit(OWNER, "a@example.com")).status).toBe("member");
  });

  it("always lets an admin in, without asking", async () => {
    const { accountAddress } = await import("@/lib/auth/account.server");
    const admin = accountAddress(ADMIN_EMAIL);
    calls.length = 0;
    answer = () => Response.json({ status: "waitlisted", place: 1 });
    expect((await admit(admin, ADMIN_EMAIL)).status).toBe("member");
    expect(await isMember(admin)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("notices access taken away, and remembers the answer for a minute", async () => {
    forgetMember(OWNER);
    memberRows = [];
    expect(await isMember(OWNER)).toBe(false);
    memberRows = [{ owner: OWNER }];
    expect(await isMember(OWNER)).toBe(false);
    forgetMember(OWNER);
    expect(await isMember(OWNER)).toBe(true);
  });
});
