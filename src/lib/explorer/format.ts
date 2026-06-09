// Formatting helpers for the QIE explorer. Blockscout returns wei amounts as
// decimal strings and timestamps as ISO strings.

// Big decimal-string → number of whole units (QIE has 18 decimals). Avoids
// BigInt/float surprises for display by splitting on the decimal boundary.
export function formatUnits(raw: string | null | undefined, decimals = 18, maxFrac = 6): string {
  if (raw == null || raw === "") return "0";
  let neg = false;
  let s = raw.trim();
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) return raw;
  s = s.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  let frac = decimals > 0 ? s.slice(s.length - decimals) : "";
  frac = frac.slice(0, maxFrac).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return neg ? `-${out}` : out;
}

// Group integer part with thousands separators (keeps any fractional part).
export function withCommas(value: string | number): string {
  const s = String(value);
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

export function formatQie(raw: string | null | undefined, maxFrac = 6): string {
  return withCommas(formatUnits(raw, 18, maxFrac));
}

// Gas price (wei) → Gwei string, adaptive for QIE's tiny values.
export function formatGwei(raw: string | null | undefined): string {
  if (!raw) return "0";
  const wei = Number(raw);
  if (!isFinite(wei) || wei === 0) return "0";
  const gwei = wei / 1e9;
  if (gwei >= 0.01) return `${gwei.toFixed(2)} Gwei`;
  if (wei >= 1e6) return `${(wei / 1e6).toFixed(2)} mGwei`;
  return `${Math.round(wei).toLocaleString()} wei`;
}

// "12 secs ago" / "3 mins ago" from an ISO timestamp.
export function timeAgo(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const now = nowMs ?? Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec} sec${sec === 1 ? "" : "s"} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return "";
  if (hash.length <= head + tail + 2) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function shortAddr(addr: string | null | undefined): string {
  return shortHash(addr, 6, 4);
}
