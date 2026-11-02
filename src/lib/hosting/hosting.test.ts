import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  domainProblem,
  publishSite,
  siteForHost,
  slugProblem,
  slugify,
  typeOf,
  type Site,
} from "./sites.server";
import { serveSite } from "./serve.server";

const OWNER = `0x${"d".repeat(40)}`;
const OTHER = `0x${"e".repeat(40)}`;

describe("names and domains", () => {
  it("turns a project name into a subdomain", () => {
    expect(slugify("Warden: Tower Defense!")).toBe("warden-tower-defense");
    expect(slugify("Ça va")).toBe("ca-va");
    expect(slugify("x")).toMatch(/^x-[0-9a-f]{4}$/);
  });

  it("keeps DevStation's own names for DevStation", () => {
    expect(slugProblem("warden")).toBeNull();
    expect(slugProblem("roots")).toContain("reserved");
    expect(slugProblem("admin")).toContain("reserved");
    expect(slugProblem("-bad")).not.toBeNull();
    expect(slugProblem("ab")).not.toBeNull();
  });

  it("takes only domains of the person's own", () => {
    expect(domainProblem("app.example.com")).toBeNull();
    expect(domainProblem("example.com")).toBeNull();
    expect(domainProblem("warden.devstation.online")).toContain("own");
    expect(domainProblem("not a domain")).not.toBeNull();
    expect(domainProblem("x.vercel.app")).not.toBeNull();
  });

  it("serves files with their types", () => {
    expect(typeOf("index.html")).toContain("text/html");
    expect(typeOf("assets/app-1a2b3c4d.js")).toContain("javascript");
    expect(typeOf("logo.webp")).toBe("image/webp");
    expect(typeOf("x.unknown")).toBe("application/octet-stream");
  });
});

// Against a stand-in database and storage.
describe("hosting", () => {
  let server: ReturnType<typeof Bun.serve>;
  const uploads: string[] = [];
  const sites: Site[] = [];
  const files = new Map<string, string>();
  const saved: Record<string, string | undefined> = {};

  const site = (patch: Partial<Site>): Site => ({
    id: "11111111-1111-1111-1111-111111111111",
    owner: OWNER,
    slug: "warden",
    name: "Warden",
    workspace: "ds-0123456789abcdef~ws-1",
    current_deploy: "d1",
    files: 2,
    bytes: 10,
    custom_domain: null,
    domain_verified: false,
    created_at: "",
    updated_at: "",
    deployed_at: null,
    ...patch,
  });

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const p = url.pathname;
        if (p.startsWith("/storage/v1/object/public/sites/")) {
          const key = decodeURIComponent(p.slice("/storage/v1/object/public/sites/".length));
          const body = files.get(key);
          return body === undefined ? new Response("missing", { status: 400 }) : new Response(body);
        }
        if (p.startsWith("/storage/v1/object/sites/")) {
          uploads.push(decodeURIComponent(p.slice("/storage/v1/object/sites/".length)));
          return Response.json({ Key: "ok" });
        }
        if (p === "/rest/v1/sites") {
          const slug = url.searchParams.get("slug")?.replace(/^eq\./, "");
          const domain = url.searchParams.get("custom_domain")?.replace(/^eq\./, "");
          if (req.method === "POST") {
            const row = { ...site({ current_deploy: null }), ...(await req.json()) };
            sites.push(row);
            return Response.json([row]);
          }
          if (req.method === "PATCH") {
            const patch = (await req.json()) as Partial<Site>;
            return Response.json([{ ...sites[0], ...patch }]);
          }
          return Response.json(
            sites.filter((s) =>
              slug ? s.slug === slug : domain ? s.custom_domain === domain : true,
            ),
          );
        }
        return Response.json([]);
      },
    });
    for (const k of ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[k] = process.env[k];
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  });

  afterAll(() => {
    server.stop(true);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("finds the site behind a hostname, and never DevStation's own", async () => {
    sites.length = 0;
    sites.push(
      site({}),
      site({ id: "2", slug: "shop", custom_domain: "shop.example.com", domain_verified: true }),
    );
    expect((await siteForHost("warden.devstation.online"))?.slug).toBe("warden");
    expect((await siteForHost("WARDEN.devstation.online:443"))?.slug).toBe("warden");
    expect(await siteForHost("roots.devstation.online")).toBeNull();
    expect(await siteForHost("devstation.online")).toBeNull();
    expect(await siteForHost("a.b.devstation.online")).toBeNull();
    expect(await siteForHost("devstation-omega.vercel.app")).toBeNull();
    expect(await siteForHost("my.app", ["my.app"])).toBeNull();
    expect((await siteForHost("shop.example.com"))?.slug).toBe("shop");
  });

  it("serves a deploy's files, and its index.html for the app's own routes", async () => {
    const s = site({ id: "s1", current_deploy: "d1" });
    files.set("s1/d1/index.html", "<h1>Warden</h1>");
    files.set("s1/d1/assets/app-1a2b3c4d.js", "console.log(1)");
    const get = (path: string, method = "GET") =>
      serveSite(s, new Request(`https://warden.devstation.online${path}`, { method }));

    const home = await get("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(home.headers.get("cache-control")).toContain("must-revalidate");
    // What the reachability check reads.
    expect(home.headers.get("x-devstation-site")).toBe("warden");
    expect(home.headers.get("x-devstation-deploy")).toBe("d1");
    expect(await home.text()).toContain("Warden");

    const js = await get("/assets/app-1a2b3c4d.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");

    // A route of the app, not a file: index.html.
    expect(await (await get("/levels/3")).text()).toContain("Warden");
    // A missing file is a 404, not the page.
    expect((await get("/missing.png")).status).toBe(404);
    expect((await get("/", "POST")).status).toBe(405);
    expect((await get("/.env")).status).toBe(404);
  });

  it("refuses a subdomain another account has, and uploads every file of a build", async () => {
    sites.length = 0;
    sites.push(site({ owner: OTHER, slug: "taken" }));
    const refused = await publishSite({
      owner: OWNER,
      slug: "taken",
      name: "Mine",
      workspace: "w",
      dist: { "index.html": "<h1>x</h1>" },
      assets: {},
    });
    expect(refused.ok).toBe(false);

    sites.length = 0;
    uploads.length = 0;
    const made = await publishSite({
      owner: OWNER,
      slug: "warden",
      name: "Warden",
      workspace: "w",
      dist: { "index.html": "<h1>x</h1>", "assets/app.js": "1", "../escape.js": "no" },
      assets: { "logo.png": Buffer.from("png").toString("base64") },
    });
    expect(made.ok).toBe(true);
    expect(uploads.map((u) => u.split("/").slice(2).join("/")).sort()).toEqual([
      "assets/app.js",
      "index.html",
      "logo.png",
    ]);
  });
});
