// DevStation build backend (Fastify).
//
//  POST /build   { source, kind }         -> compiles an Anchor program with the
//                                            installed Solana/Anchor toolchain and
//                                            returns { so: base64, idl, name }.
//  POST /upload  (multipart: image + fields) -> stores the image + a Metaplex
//                                            metadata JSON and returns short URLs
//                                            { imageUrl, metadataUrl } usable as an
//                                            on-chain token/NFT uri (<200 chars).
//  GET  /health  -> { ok, toolchain }
//
// Point DevStation at this server with VITE_SOLANA_BUILD_API=<this server's URL>.
// The /build route needs Rust + Solana CLI + Anchor on the host (see Dockerfile);
// /upload works with plain Node, so metadata hosting is available even without
// the compiler.

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEMPLATE = join(ROOT, "anchor-template");
const UPLOADS = join(ROOT, "uploads");
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ANCHOR = process.env.ANCHOR_BIN || "anchor";

await mkdir(UPLOADS, { recursive: true });

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
await app.register(fstatic, { root: UPLOADS, prefix: "/uploads/" });

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: -1, out, err: err + String(e) }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

async function hasToolchain() {
  const r = await run(ANCHOR, ["--version"]);
  return r.code === 0;
}

// Shared-secret guard. /build compiles arbitrary submitted Rust and /upload
// writes files, so when this server is reachable on a public address both must
// require a token. Set BUILD_API_TOKEN to enable; leave it unset for a purely
// local/trusted deployment. GET /health stays open so health checks and the
// app's "is the build service configured" probe keep working.
const AUTH_TOKEN = process.env.BUILD_API_TOKEN || "";
const GUARDED = new Set(["/build", "/upload"]);

app.addHook("onRequest", async (req, reply) => {
  if (!AUTH_TOKEN) return;
  if (!GUARDED.has(req.routerPath ?? req.url.split("?")[0])) return;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== AUTH_TOKEN) {
    return reply.code(401).send({ error: "Unauthorized — send 'Authorization: Bearer <token>'." });
  }
});

app.get("/health", async () => ({ ok: true, toolchain: (await hasToolchain()) ? "anchor" : "missing" }));

// Compile an Anchor program → .so + IDL.
app.post("/build", async (req, reply) => {
  const { source } = req.body || {};
  if (!source || typeof source !== "string") return reply.code(400).send({ error: "Missing 'source'." });
  if (!(await hasToolchain())) {
    return reply.code(503).send({
      error: "Build toolchain not installed on this server. Install Rust + Solana CLI + Anchor (see the Dockerfile), or run this server in the provided Docker image.",
    });
  }

  const dir = await mkdtemp(join(tmpdir(), "devbuild-"));
  try {
    await cp(TEMPLATE, dir, { recursive: true });
    await mkdir(join(dir, "programs/devprogram/src"), { recursive: true });
    await writeFile(join(dir, "programs/devprogram/src/lib.rs"), source);

    // Compile the program + IDL. The image ships a MODERN Anchor (1.1.x, targeting
    // Solana 3.x) with its matching platform-tools, so a plain `anchor build`
    // works — the toolchain is contemporary with today's crates.io graph. (The
    // long, ugly `edition2024` / MSRV / `--tools-version` workarounds that used to
    // live here were a symptom of the old Anchor 0.31.1 pinning a 2024-era
    // rustc 1.79; upgrading Anchor removed the whole problem.)
    const build = await run(ANCHOR, ["build"], dir);
    if (build.code !== 0) {
      return reply.code(422).send({ error: "anchor build failed", log: (build.err || build.out).slice(-5000) });
    }

    const deployDir = join(dir, "target/deploy");
    const soFile = existsSync(deployDir) ? (await readdir(deployDir)).find((f) => f.endsWith(".so")) : null;
    if (!soFile) return reply.code(500).send({ error: "Build produced no .so binary." });
    const soBytes = await readFile(join(deployDir, soFile));

    let idl = null;
    let name = soFile.replace(/\.so$/, "");
    const idlDir = join(dir, "target/idl");
    if (existsSync(idlDir)) {
      const idlFile = (await readdir(idlDir)).find((f) => f.endsWith(".json"));
      if (idlFile) {
        idl = JSON.parse(await readFile(join(idlDir, idlFile), "utf8"));
        name = idlFile.replace(/\.json$/, "");
      }
    }
    return { so: soBytes.toString("base64"), idl, name };
  } catch (e) {
    return reply.code(500).send({ error: String(e?.message || e) });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// Host an NFT/token image + a Metaplex metadata JSON. Returns short URLs.
app.post("/upload", async (req, reply) => {
  try {
    const fields = {};
    let imageUrl = null;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const ext = (extname(part.filename || "").slice(1) || "png").toLowerCase();
        const fn = `${randomUUID()}.${ext}`;
        await writeFile(join(UPLOADS, fn), await part.toBuffer());
        imageUrl = `${PUBLIC_URL}/uploads/${fn}`;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    let attributes = [];
    try {
      attributes = fields.attributes ? JSON.parse(fields.attributes) : [];
    } catch {
      /* ignore malformed attributes */
    }
    const metadata = {
      name: fields.name || "",
      symbol: fields.symbol || "",
      description: fields.description || "",
      image: imageUrl || fields.image || "",
      attributes,
      properties: imageUrl ? { files: [{ uri: imageUrl, type: `image/${imageUrl.split(".").pop()}` }], category: "image" } : {},
    };
    const metaFn = `${randomUUID()}.json`;
    await writeFile(join(UPLOADS, metaFn), JSON.stringify(metadata, null, 2));
    return { imageUrl, metadataUrl: `${PUBLIC_URL}/uploads/${metaFn}` };
  } catch (e) {
    return reply.code(500).send({ error: String(e?.message || e) });
  }
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`DevStation build server listening on ${PORT} (public: ${PUBLIC_URL})`);
});
