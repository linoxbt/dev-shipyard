import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Executor } from "./executor";

// The agent's eyes: open a page in a real browser (Playwright's Chromium),
// take a screenshot, and hand it back so the model can look at it and the
// person can see it in the chat.
//
// The page is either a URL (a dev server the agent started) or a folder of
// built files, which the script serves itself on a free port, so a Vite or
// Next export is checked the way it will be served rather than over file://,
// where module scripts do not load.
//
// Playwright is installed on first use into a tools folder outside the
// project, with its browser, so it is not added to the person's app.

export const PLAYWRIGHT_VERSION = "1.56.1";

export interface ShotArgs {
  url?: string;
  dir?: string;
  path?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
}

export interface Shot {
  ok: boolean;
  output: string;
  /** The screenshot's name, for the chat to fetch its thumbnail. */
  name?: string;
  /** What the model looks at: a JPEG data URL. */
  image?: string;
}

/** Inside the project, where previews and file listings never look. */
export const SHOTS_DIR = ".devstation/shots";

const SCRIPT = String.raw`
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm" };
(async () => {
  let server = null;
  let url = a.url;
  if (!url) {
    const root = path.resolve(a.dir);
    server = http.createServer((req, res) => {
      let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) file = path.join(root, "index.html");
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = "http://127.0.0.1:" + server.address().port + (a.path || "/");
  }
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: a.width, height: a.height } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 300)));
  page.on("requestfailed", (r) => errors.push("Failed to load " + r.url().slice(0, 200) + ": " + ((r.failure() || {}).errorText || "")));
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    status = resp ? resp.status() : null;
  } catch (e) {
    errors.push("Opening the page: " + String(e.message || e).split("\n")[0]);
  }
  await page.waitForTimeout(700);
  const png = await page.screenshot({ fullPage: !!a.fullPage });
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
  // Shrunk in a blank page of its own, so the app's own security policy
  // cannot get in the way.
  const tool = await browser.newPage();
  const shrink = (width, quality) => tool.evaluate(async ([b64, width, quality]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const scale = Math.min(1, width / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.min(Math.round(img.height * scale), Math.round(width * 2.5));
    c.getContext("2d").drawImage(img, 0, 0, Math.round(img.width * scale), Math.round(img.height * scale));
    return c.toDataURL("image/jpeg", quality).split(",")[1];
  }, [png.toString("base64"), width, quality]);
  fs.writeFileSync(a.out + ".model.jpg", Buffer.from(await shrink(1280, 0.72), "base64"));
  fs.writeFileSync(a.out + ".jpg", Buffer.from(await shrink(640, 0.6), "base64"));
  await browser.close();
  if (server) server.close();
  console.log("@@SHOT@@" + JSON.stringify({ url, status, title, errors: errors.slice(0, 12), text: text.replace(/\s+/g, " ").trim().slice(0, 600) }));
})().catch((e) => { console.log("@@SHOT@@" + JSON.stringify({ fatal: String((e && e.message) || e).split("\n").slice(0, 3).join(" ") })); process.exit(1); });
`;

/** Install Playwright and Chromium once (outside the project), then run the script. */
export function shotCommand(argsFile: string, scriptFile: string): string {
  const v = PLAYWRIGHT_VERSION;
  return [
    'TOOLS="$HOME/.devstation-tools"',
    'export NODE_PATH="$TOOLS/node_modules${NODE_PATH:+:$NODE_PATH}"',
    `if ! node -e "require('playwright')" >/dev/null 2>&1; then mkdir -p "$TOOLS" && npm install --prefix "$TOOLS" --no-audit --no-fund --loglevel=error playwright@${v} >/dev/null 2>&1 || { echo "@@SHOT@@{\\"fatal\\":\\"Playwright could not be installed (npm install failed).\\"}"; exit 1; }; fi`,
    `if [ ! -f "$TOOLS/.chromium-${v}" ]; then (npx --prefix "$TOOLS" playwright install --with-deps chromium >/dev/null 2>&1 || npx --prefix "$TOOLS" playwright install chromium >/dev/null 2>&1) && touch "$TOOLS/.chromium-${v}"; fi`,
    `node ${JSON.stringify(scriptFile)} ${JSON.stringify(argsFile)}`,
  ].join("\n");
}

let counter = 0;

/** Take a screenshot of a page in the workspace's machine. */
export async function takeScreenshot(
  executor: Executor,
  root: string,
  args: ShotArgs,
  signal?: AbortSignal,
): Promise<Shot> {
  const width = clamp(args.width, 320, 1920, 1280);
  const height = clamp(args.height, 320, 2000, 800);
  let dir: string | undefined;
  if (!args.url) {
    dir = args.dir ?? (existsSync(join(root, "index.html")) ? "." : "dist");
    if (dir.startsWith("/") || dir.split("/").includes("..")) {
      return { ok: false, output: "dir must be a folder inside the project." };
    }
    if (!existsSync(join(root, dir, "index.html"))) {
      return {
        ok: false,
        output: `There is no ${dir === "." ? "" : `${dir}/`}index.html to open. Build the app first, pass the folder the build writes with "dir", or start a server and pass its "url".`,
      };
    }
  } else if (!/^https?:\/\//.test(args.url)) {
    return { ok: false, output: "url must start with http:// or https://." };
  }

  mkdirSync(join(root, SHOTS_DIR), { recursive: true });
  const name = `shot-${Date.now().toString(36)}-${++counter}`;
  const out = `${SHOTS_DIR}/${name}`;
  writeFileSync(join(root, ".devstation/shot.cjs"), SCRIPT);
  writeFileSync(
    join(root, ".devstation/shot-args.json"),
    JSON.stringify({
      url: args.url,
      dir,
      path: args.path,
      width,
      height,
      fullPage: !!args.fullPage,
      out,
    }),
  );
  const result = await executor.run(
    shotCommand(".devstation/shot-args.json", ".devstation/shot.cjs"),
    {
      cwd: root,
      timeoutMs: 600_000,
      signal,
      // The first screenshot installs Playwright and its browser.
      network: true,
    },
  );
  const line = `${result.stdout}`.split("\n").find((l) => l.startsWith("@@SHOT@@"));
  let report: {
    url?: string;
    status?: number | null;
    title?: string;
    errors?: string[];
    text?: string;
    fatal?: string;
  } = {};
  try {
    report = line ? JSON.parse(line.slice(8)) : {};
  } catch {
    report = {};
  }
  if (!line || report.fatal || !existsSync(join(root, `${out}.model.jpg`))) {
    const why =
      report.fatal ?? `${result.stderr}`.trim().split("\n").slice(-4).join(" ").slice(0, 400);
    return {
      ok: false,
      output: `The screenshot could not be taken. ${why || "The browser did not start."}`,
    };
  }
  const errors = report.errors ?? [];
  const lines = [
    `Screenshot of ${report.url} at ${width}x${height}${args.fullPage ? " (full page)" : ""}.`,
    `HTTP status: ${report.status ?? "none"}. Title: ${report.title ? `"${report.title}"` : "(none)"}.`,
    errors.length
      ? `Errors in the page (${errors.length}):\n${errors.map((e) => `- ${e}`).join("\n")}`
      : "No errors in the browser console.",
    report.text
      ? `Visible text begins: ${report.text}`
      : "The page shows no text at all: it may be blank.",
    "The image follows. Look at it carefully: layout, spacing, contrast, broken or missing parts.",
  ];
  return {
    ok: true,
    output: lines.join("\n"),
    name,
    image: `data:image/jpeg;base64,${readFileSync(join(root, `${out}.model.jpg`)).toString("base64")}`,
  };
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}
