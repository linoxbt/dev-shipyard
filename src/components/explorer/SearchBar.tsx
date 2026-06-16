import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, FileCode2, Wallet, Receipt, Boxes, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { useExplorerNetwork } from "@/lib/explorer/network";
import { storage, type SearchEntry } from "@/lib/storage";
import { shortAddr, shortHash } from "@/lib/explorer/format";

// Universal explorer search: routes a query to the right detail page by shape.
// Address/contract (0x + 40), tx hash (0x + 64), or block number. Stays on the
// network in the current URL. Recent searches are persisted to localStorage and
// surfaced in a dropdown when the input is focused — Etherscan-style; for
// contracts the resolved name is shown once the address page has loaded it.
export function SearchBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<SearchEntry[]>([]);
  const navigate = useNavigate();
  const network = useExplorerNetwork();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Recent searches are client-only (localStorage); load after mount.
  const refreshRecent = () => setRecent(storage.loadSearches());
  useEffect(refreshRecent, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Classify a query, record it, and navigate. Returns false on an invalid one.
  const go = (value: string): boolean => {
    const v = value.trim();
    if (!v) return false;
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      storage.addSearch({ query: v, kind: "tx", network });
      navigate({ to: "/explorer/$network/tx/$hash", params: { network, hash: v } });
    } else if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
      storage.addSearch({ query: v, kind: "address", network });
      navigate({ to: "/explorer/$network/address/$hash", params: { network, hash: v } });
    } else if (/^\d+$/.test(v)) {
      storage.addSearch({ query: v, kind: "block", network });
      navigate({ to: "/explorer/$network/block/$height", params: { network, height: v } });
    } else {
      toast.error("Enter a transaction hash, address, or block number");
      return false;
    }
    refreshRecent();
    setOpen(false);
    return true;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    go(q);
  };

  // Recent entries scoped to the network in the current URL.
  const networkRecent = recent.filter((s) => s.network === network);

  return (
    <div ref={wrapRef} className="relative w-full">
      <form onSubmit={submit} className="relative w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search by address / txn hash / block number"
          className="w-full rounded border border-border bg-background py-2.5 pl-9 pr-24 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Search
        </button>
      </form>

      {open && networkRecent.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
              <Clock className="h-3 w-3" /> Recent searches
            </span>
            <button
              type="button"
              onClick={() => {
                storage.clearSearches();
                refreshRecent();
                setOpen(false);
              }}
              className="flex items-center gap-1 font-mono text-[10px] text-meta hover:text-danger"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {networkRecent.map((s) => (
              <li key={`${s.kind}:${s.query}`}>
                <button
                  type="button"
                  // Navigate directly (also re-records, bumping it to the top).
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(s.query);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <RecentIcon entry={s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-foreground">
                      {s.name || displayQuery(s)}
                    </span>
                    {s.name && (
                      <span className="block truncate font-mono text-[10px] text-meta">
                        {displayQuery(s)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-meta">
                    {s.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function displayQuery(s: SearchEntry): string {
  if (s.kind === "tx") return shortHash(s.query);
  if (s.kind === "address") return shortAddr(s.query);
  return `Block #${s.query}`;
}

function RecentIcon({ entry }: { entry: SearchEntry }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-meta";
  if (entry.kind === "tx") return <Receipt className={cls} />;
  if (entry.kind === "block") return <Boxes className={cls} />;
  return entry.isContract ? <FileCode2 className={cls} /> : <Wallet className={cls} />;
}
