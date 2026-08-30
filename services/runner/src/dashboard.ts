// The dashboard page.
//
// One self-contained HTML document with inline CSS and JS, served by the
// runner itself. No build step and no CDN: this service exists to watch a
// machine, and something you look at when things are going wrong should not
// depend on a bundler or somebody else's network being up.
//
// The page fetches /api/stats on a timer and re-renders. All state lives on the
// server; the page is a view.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
:root {
  --bg: #0a0e13; --surface: #11161d; --surface-2: #171d26; --border: #232b36;
  --fg: #e6edf3; --muted: #8b98a8; --meta: #5c6875;
  --ok: #2ea043; --warn: #d29922; --bad: #f85149; --accent: #e67e22; --info: #1294a9;
  --mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 13px/1.5 var(--mono);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); }
.wrap { max-width: 1180px; margin: 0 auto; padding: 20px 20px 60px; }

header { display: flex; align-items: center; gap: 12px; padding: 4px 0 18px; }
header h1 { font-size: 15px; font-weight: 700; margin: 0; letter-spacing: -0.2px; }
header h1 span { color: var(--accent); }
.sub { color: var(--meta); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.spacer { flex: 1; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
  border: 1px solid var(--border); border-radius: 999px; font-size: 11px; color: var(--muted);
}
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(46,160,67,.15); }
.dot.bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(248,81,73,.15); }
.dot.warn { background: var(--warn); box-shadow: 0 0 0 3px rgba(210,153,34,.15); }
button.link {
  background: none; border: 1px solid var(--border); color: var(--muted);
  border-radius: 4px; padding: 4px 10px; font: inherit; font-size: 11px; cursor: pointer;
}
button.link:hover { color: var(--fg); border-color: var(--accent); }

.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 13px 15px;
}
.card h2 {
  margin: 0 0 10px; font-size: 10px; font-weight: 600; color: var(--meta);
  text-transform: uppercase; letter-spacing: 0.09em;
}
.stat { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.15; }
.stat small { font-size: 12px; font-weight: 500; color: var(--muted); margin-left: 3px; }
.note { color: var(--meta); font-size: 11px; margin-top: 5px; }

.bar { height: 4px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: 9px; }
.bar > i { display: block; height: 100%; background: var(--info); border-radius: 999px; transition: width .4s; }
.bar > i.warn { background: var(--warn); }
.bar > i.bad { background: var(--bad); }

section { margin-top: 22px; }
section > h2 {
  font-size: 10px; font-weight: 600; color: var(--meta); margin: 0 0 10px;
  text-transform: uppercase; letter-spacing: 0.09em;
}

.job {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; margin-bottom: 8px; overflow: hidden;
}
.job > summary {
  padding: 11px 14px; cursor: pointer; display: flex; align-items: center;
  gap: 11px; list-style: none;
}
.job > summary::-webkit-details-marker { display: none; }
.job > summary:hover { background: var(--surface-2); }
.job .when { color: var(--muted); min-width: 108px; font-size: 12px; }
.job .total { color: var(--fg); font-variant-numeric: tabular-nums; }
.phases { display: flex; gap: 5px; flex-wrap: wrap; margin-left: auto; }
.ph {
  font-size: 10px; padding: 2px 7px; border-radius: 4px;
  border: 1px solid var(--border); color: var(--muted); white-space: nowrap;
}
.ph.ok { border-color: rgba(46,160,67,.4); color: #7ee08a; }
.ph.bad { border-color: rgba(248,81,73,.5); color: #ff9992; background: rgba(248,81,73,.08); }
.job .body { border-top: 1px solid var(--border); padding: 12px 14px; }
.job .body h3 { font-size: 11px; color: var(--muted); margin: 0 0 6px; font-weight: 600; }
pre {
  margin: 0 0 12px; padding: 10px 12px; background: #070a0e; border: 1px solid var(--border);
  border-radius: 6px; overflow-x: auto; font-size: 11px; line-height: 1.55;
  color: var(--muted); white-space: pre-wrap; word-break: break-word;
}
pre.bad { color: #ffb3ad; border-color: rgba(248,81,73,.3); }
.empty { color: var(--meta); padding: 26px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
.err { color: var(--bad); }
footer { margin-top: 30px; color: var(--meta); font-size: 11px; display: flex; gap: 14px; }
@media (max-width: 640px) {
  .job > summary { flex-wrap: wrap; }
  .phases { margin-left: 0; width: 100%; }
}
`;

const SCRIPT = String.raw`
const $ = (id) => document.getElementById(id);

function fmtBytes(n) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
}
function fmtDur(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m + "m " + String(s % 60).padStart(2, "0") + "s";
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + "d " + h + "h";
  if (h) return h + "h " + m + "m";
  return m + "m";
}
function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}
function esc(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function level(pct) { return pct >= 90 ? "bad" : pct >= 75 ? "warn" : ""; }

// Track which jobs the reader has opened, so a refresh does not close them.
const opened = new Set();

function renderJobs(jobs) {
  if (!jobs.length) {
    return '<div class="empty">No builds recorded yet. Run one from the App Builder and it will appear here.</div>';
  }
  return jobs.map((j) => {
    const phases = j.phases.map((p) =>
      '<span class="ph ' + (p.ok ? "ok" : "bad") + '">' + esc(p.phase) +
      " " + fmtDur(p.durationMs) + (p.timedOut ? " ⏱" : "") + "</span>"
    ).join("");
    const logs = j.phases.filter((p) => p.log).map((p) =>
      "<h3>" + esc(p.phase) + (p.ok ? "" : " — failed") + "</h3>" +
      '<pre class="' + (p.ok ? "" : "bad") + '">' + esc(p.log) + "</pre>"
    ).join("");
    const err = j.error ? '<h3 class="err">Did not run</h3><pre class="bad">' + esc(j.error) + "</pre>" : "";
    return '<details class="job" data-id="' + esc(j.id) + '"' + (opened.has(j.id) ? " open" : "") + ">" +
      "<summary>" +
        '<span class="dot ' + (j.ok ? "ok" : "bad") + '"></span>' +
        '<span class="when">' + ago(j.startedAt) + "</span>" +
        '<span class="total">' + fmtDur(j.durationMs) + "</span>" +
        '<span class="phases">' + phases + "</span>" +
      "</summary>" +
      '<div class="body">' + err + (logs || "<h3>No output retained</h3>") + "</div>" +
    "</details>";
  }).join("");
}

async function refresh() {
  let s;
  try {
    const r = await fetch("/api/stats", { credentials: "same-origin" });
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    s = await r.json();
  } catch (e) {
    $("conn").className = "dot bad";
    $("conn-label").textContent = "disconnected";
    return;
  }
  $("conn").className = "dot ok";
  $("conn-label").textContent = "live";

  const r = s.runner, h = s.host, hist = s.history;

  $("iso").textContent = r.runtime;
  $("iso-dot").className = "dot " + (r.runtimeAvailable && r.docker ? "ok" : "bad");
  $("iso-note").textContent = r.runtimeAvailable
    ? (r.runtime === "runsc" ? "user-space kernel between jobs and the host" : "container isolation only")
    : "runtime NOT registered with docker";

  $("queue").textContent = r.active;
  $("queue-sub").textContent = "/" + r.maxConcurrent;
  $("queue-note").textContent = r.queued + " waiting (max " + r.maxQueued + ")";

  $("runner-up").textContent = fmtUptime(r.uptimeSec);
  $("runner-note").textContent = r.image;

  const memPct = Math.round((h.memUsedBytes / h.memTotalBytes) * 100);
  $("mem").textContent = memPct + "%";
  $("mem-note").textContent = fmtBytes(h.memUsedBytes) + " of " + fmtBytes(h.memTotalBytes);
  $("mem-bar").style.width = memPct + "%";
  $("mem-bar").className = level(memPct);

  if (h.diskTotalBytes) {
    const usedPct = Math.round(((h.diskTotalBytes - h.diskFreeBytes) / h.diskTotalBytes) * 100);
    $("disk").textContent = usedPct + "%";
    $("disk-note").textContent = fmtBytes(h.diskFreeBytes) + " free";
    $("disk-bar").style.width = usedPct + "%";
    $("disk-bar").className = level(usedPct);
  }

  const loadPct = Math.min(100, Math.round((h.load1 / h.cpuCount) * 100));
  $("load").textContent = h.load1.toFixed(2);
  $("load-note").textContent = h.cpuCount + " cores · " + h.load5.toFixed(2) + " / " + h.load15.toFixed(2);
  $("load-bar").style.width = loadPct + "%";
  $("load-bar").className = level(loadPct);

  $("builds").textContent = hist.total;
  $("builds-note").textContent = hist.ok + " passed · " + hist.failed + " failed";
  $("median").textContent = fmtDur(hist.medianMs);
  $("median-note").textContent = hist.lastAt ? "last " + ago(hist.lastAt) : "none yet";

  $("host-up").textContent = fmtUptime(h.osUptimeSec);

  // Remember open rows before replacing them.
  document.querySelectorAll(".job[open]").forEach((d) => opened.add(d.dataset.id));
  document.querySelectorAll(".job:not([open])").forEach((d) => opened.delete(d.dataset.id));
  $("jobs").innerHTML = renderJobs(s.jobs);
  $("updated").textContent = new Date(s.now).toLocaleTimeString();
}

refresh();
setInterval(refresh, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
`;

export function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Build Runner — DevStation</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Dev<span>Station</span> Build Runner</h1>
      <div class="sub">backend.devstation.online</div>
    </div>
    <div class="spacer"></div>
    <span class="pill"><span class="dot" id="conn"></span><span id="conn-label">connecting</span></span>
    <span class="pill">updated <span id="updated">—</span></span>
    <form method="POST" action="/logout" style="margin:0"><button class="link" type="submit">Sign out</button></form>
  </header>

  <div class="grid">
    <div class="card">
      <h2>Isolation</h2>
      <div class="stat"><span class="dot" id="iso-dot"></span> <span id="iso">—</span></div>
      <div class="note" id="iso-note">—</div>
    </div>
    <div class="card">
      <h2>Running now</h2>
      <div class="stat"><span id="queue">—</span><small id="queue-sub"></small></div>
      <div class="note" id="queue-note">—</div>
    </div>
    <div class="card">
      <h2>Builds recorded</h2>
      <div class="stat" id="builds">—</div>
      <div class="note" id="builds-note">—</div>
    </div>
    <div class="card">
      <h2>Median build</h2>
      <div class="stat" id="median">—</div>
      <div class="note" id="median-note">—</div>
    </div>
  </div>

  <section>
    <h2>Host</h2>
    <div class="grid">
      <div class="card">
        <h2>Memory</h2>
        <div class="stat" id="mem">—</div>
        <div class="note" id="mem-note">—</div>
        <div class="bar"><i id="mem-bar"></i></div>
      </div>
      <div class="card">
        <h2>Disk</h2>
        <div class="stat" id="disk">—</div>
        <div class="note" id="disk-note">—</div>
        <div class="bar"><i id="disk-bar"></i></div>
      </div>
      <div class="card">
        <h2>Load</h2>
        <div class="stat" id="load">—</div>
        <div class="note" id="load-note">—</div>
        <div class="bar"><i id="load-bar"></i></div>
      </div>
      <div class="card">
        <h2>Uptime</h2>
        <div class="stat" id="runner-up">—</div>
        <div class="note" id="runner-note">—</div>
        <div class="note">host up <span id="host-up">—</span></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Recent builds</h2>
    <div id="jobs"><div class="empty">Loading…</div></div>
  </section>

  <footer>
    <span>Read-only view. Submitting builds needs the runner token, which this session does not carry.</span>
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Sign in — Build Runner</title>
<style>${STYLE}
.login { max-width: 320px; margin: 14vh auto; }
.login h1 { font-size: 15px; margin: 0 0 4px; }
.login form { margin-top: 18px; display: flex; flex-direction: column; gap: 9px; }
.login input {
  background: var(--bg); border: 1px solid var(--border); color: var(--fg);
  border-radius: 6px; padding: 9px 11px; font: inherit;
}
.login input:focus { outline: none; border-color: var(--accent); }
.login button {
  background: var(--accent); border: none; color: #10161d; font: inherit; font-weight: 600;
  border-radius: 6px; padding: 9px; cursor: pointer;
}
.login .msg { color: var(--bad); font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>
<div class="login">
  <h1>Dev<span style="color:var(--accent)">Station</span> Build Runner</h1>
  <div class="sub">sign in to view</div>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Dashboard password" autofocus
           autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
  ${error ? `<div class="msg">${escapeHtml(error)}</div>` : ""}
</div>
</body>
</html>`;
}
