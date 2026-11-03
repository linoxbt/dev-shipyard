import { promises as dns } from "node:dns";
import { Resolver } from "node:dns/promises";

// What a custom domain's DNS says right now, asked of the domain's own
// nameservers rather than a caching resolver: a "no such record" a resolver
// saw before the person added their records can be kept for an hour, which
// reads as DNS taking forever. And when a record is wrong, it says how, in
// the words a person needs to fix it at their DNS host.

export interface DnsRecord {
  type: string;
  /** The full name: _devstation.shop.example.com. */
  name: string;
  /** The name as DNS hosts ask for it, relative to the domain: "@" for the
   *  domain itself, "_devstation" for _devstation.example.com. */
  host: string;
  value: string;
}

/** Answers from DNS, injectable for tests. */
export interface Lookup {
  a(name: string): Promise<string[]>;
  aaaa(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
  txt(name: string): Promise<string[]>;
  /** The zone the name lives in (the domain whose nameservers answer it). */
  zone(name: string): Promise<string>;
}

/** Vercel's addresses for an apex domain: the classic one and its newer range. */
const VERCEL_A = /^(76\.76\.21\.\d+|216\.198\.79\.\d+|66\.33\.60\.\d+)$/;

const twoLabel = (domain: string) => domain.split(".").slice(-2).join(".");

export function hostFor(name: string, zone: string): string {
  const n = name.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase();
  if (n === z) return "@";
  return n.endsWith(`.${z}`) ? n.slice(0, -(z.length + 1)) : n;
}

const none = async () => [] as string[];

type Kind = "A" | "AAAA" | "CNAME" | "TXT" | "NS";
/** One way of asking DNS. It throws when it could not ask (a timeout, no
 *  network) and answers [] when the name plainly has no such record. */
type Source = (name: string, kind: Kind) => Promise<string[]>;

const definitive = (error: unknown) => {
  const code = (error as { code?: string }).code;
  return code === "ENOTFOUND" || code === "ENODATA";
};

function resolverSource(
  r: Pick<Resolver, "resolve4" | "resolve6" | "resolveCname" | "resolveTxt" | "resolveNs">,
): Source {
  return async (name, kind) => {
    try {
      if (kind === "A") return await r.resolve4(name);
      if (kind === "AAAA") return await r.resolve6(name);
      if (kind === "CNAME") return await r.resolveCname(name);
      if (kind === "NS") return await r.resolveNs(name);
      return (await r.resolveTxt(name)).map((chunks) => chunks.join(""));
    } catch (error) {
      if (definitive(error)) return [];
      throw error;
    }
  };
}

const TYPE: Record<Kind, number> = { A: 1, NS: 2, CNAME: 5, TXT: 16, AAAA: 28 };

/** DNS over HTTPS, for where plain DNS cannot get out. */
export function dohSource(
  base = "https://dns.google/resolve",
  fetcher: typeof fetch = fetch,
): Source {
  return async (name, kind) => {
    const res = await fetcher(`${base}?name=${encodeURIComponent(name)}&type=${kind}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`DNS over HTTPS answered ${res.status}`);
    const body = (await res.json()) as {
      Status?: number;
      Answer?: { type: number; data: string }[];
    };
    // 3 is "no such name": an answer. Anything else but 0 is a failure.
    if (body.Status === 3) return [];
    if (body.Status !== 0) throw new Error(`DNS over HTTPS status ${body.Status}`);
    return (body.Answer ?? [])
      .filter((a) => a.type === TYPE[kind])
      .map((a) =>
        kind === "TXT"
          ? // "part one" "part two", as one value.
            (a.data
              .match(/"((?:[^"\\]|\\.)*)"/g)
              ?.map((q) => q.slice(1, -1))
              .join("") ?? a.data)
          : a.data.replace(/\.$/, ""),
      );
  };
}

/** The first source that can answer does; a lookup nobody can answer is []. */
function chain(sources: Source[]): Omit<Lookup, "zone"> {
  const ask = async (name: string, kind: Kind) => {
    for (const source of sources) {
      try {
        return await source(name, kind);
      } catch {
        // Try the next way of asking.
      }
    }
    return [];
  };
  return {
    a: (n) => ask(n, "A"),
    aaaa: (n) => ask(n, "AAAA"),
    cname: (n) => ask(n, "CNAME"),
    txt: (n) => ask(n, "TXT"),
  };
}

/**
 * A lookup that asks the domain's own nameservers first (always current),
 * then DNS over HTTPS, then this machine's resolver.
 */
export async function authoritative(domain: string): Promise<Lookup> {
  const doh = dohSource();
  const system = resolverSource(dns);
  const general = chain([system, doh]);
  const ns = async (name: string) => {
    for (const source of [system, doh]) {
      try {
        return await source(name, "NS");
      } catch {
        // next
      }
    }
    return [];
  };
  let zone = twoLabel(domain);
  let servers: string[] = [];
  // The zone is the nearest name with nameservers of its own.
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const names = await ns(candidate);
    if (names.length) {
      zone = candidate;
      servers = (await Promise.all(names.slice(0, 3).map((h) => general.a(h)))).flat();
      break;
    }
  }
  const sources: Source[] = [];
  if (servers.length) {
    const own = new Resolver({ timeout: 2500, tries: 1 });
    own.setServers(servers);
    sources.push(resolverSource(own));
  }
  sources.push(doh, system);
  return { ...chain(sources), zone: async () => zone };
}

export interface Diagnosis {
  /** The ownership TXT record is there (also when saved under a doubled name,
   *  which only the domain's owner could have made either). */
  owned: boolean;
  /** The domain points at the host. */
  pointed: boolean;
  /** What is wrong, one plain sentence each, for the person to fix. */
  problems: string[];
}

/**
 * Check each record a domain needs against what its DNS says now.
 * `records` are the ones shown to the person; `ownership` names the TXT
 * record that proves the domain is theirs.
 */
export async function diagnose(
  domain: string,
  records: DnsRecord[],
  ownership: { name: string; value: string },
  lookup: Lookup,
): Promise<Diagnosis> {
  const zone = await lookup.zone(domain);
  const problems: string[] = [];
  let owned = false;
  let pointed = false;

  for (const r of records) {
    if (r.type === "A") {
      const [found, six, alias] = await Promise.all([
        lookup.a(r.name),
        lookup.aaaa(r.name),
        lookup.cname(r.name).catch(none),
      ]);
      const ours = found.filter((ip) => VERCEL_A.test(ip));
      const others = found.filter((ip) => !VERCEL_A.test(ip));
      if (!found.length && !alias.length) {
        problems.push(`There is no A record for ${r.host} yet. Add one with the value ${r.value}.`);
      } else if (!ours.length) {
        problems.push(
          `The A record for ${r.host} points to ${found.join(", ") || alias.join(", ")}, not ${r.value}. Change it to ${r.value}.`,
        );
      } else {
        pointed = others.length === 0 && six.length === 0;
      }
      if (ours.length && others.length) {
        // 162.255.119.x is what Namecheap's own redirect and parking answer
        // with: it does not show as an A record there, so name the real row.
        const namecheap = others.some((ip) => /^162\.255\.119\.\d+$/.test(ip));
        problems.push(
          namecheap
            ? `Delete the "URL Redirect Record" for ${r.host} at Namecheap (Domain List, Manage, Advanced DNS, Host Records). It is Namecheap's redirect, answering with ${others.join(", ")} beside your A record, so some visitors get Namecheap's page instead of your app. Keep only the A record ${r.value}.`
            : `Remove the other A record for ${r.host} (${others.join(", ")}). With two, some visitors are sent there instead of your app.`,
        );
      }
      if (six.length) {
        problems.push(
          `Remove the AAAA record for ${r.host} (${six.join(", ")}): visitors on IPv6 are sent there instead of your app.`,
        );
      }
      continue;
    }

    if (r.type === "CNAME") {
      const found = await lookup.cname(r.name);
      if (found.some((c) => /vercel-dns\.com\.?$/i.test(c))) {
        pointed = true;
      } else if (found.length) {
        problems.push(
          `The CNAME record for ${r.host} points to ${found[0]}. Change it to ${r.value}.`,
        );
      } else {
        const a = await lookup.a(r.name);
        problems.push(
          a.length
            ? `${r.host} has an A record (${a.join(", ")}) instead of a CNAME. Replace it with a CNAME record whose value is ${r.value}.`
            : `There is no CNAME record for ${r.host} yet. Add one with the value ${r.value}.`,
        );
      }
      continue;
    }

    if (r.type === "TXT") {
      const isOwnership = r.name === ownership.name;
      const found = await lookup.txt(r.name);
      if (found.includes(r.value)) {
        if (isOwnership) owned = true;
        continue;
      }
      // DNS hosts add the domain to whatever is typed as the name, so
      // "_devstation.example.com" typed in full becomes
      // _devstation.example.com.example.com.
      const doubled = `${r.name}.${zone}`;
      const there = await lookup.txt(doubled);
      if (there.includes(r.value)) {
        if (isOwnership) {
          owned = true;
          continue;
        }
        problems.push(
          `The TXT record was saved as ${doubled}. In the Host field put only ${r.host}: your DNS host adds ${zone} by itself.`,
        );
        continue;
      }
      problems.push(
        found.length
          ? `The TXT record ${r.host} has a different value. It must be exactly ${r.value}.`
          : `There is no TXT record for ${r.host} yet. Add one with the value ${r.value}.`,
      );
    }
  }
  return { owned, pointed, problems };
}
