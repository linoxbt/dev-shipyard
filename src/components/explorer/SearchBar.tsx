import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { useExplorerNetwork } from "@/lib/explorer/network";

// Universal explorer search: routes a query to the right detail page by shape.
// Address/contract (0x + 40), tx hash (0x + 64), or block number. Stays on the
// network in the current URL.
export function SearchBar() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const network = useExplorerNetwork();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      navigate({ to: "/explorer/$network/tx/$hash", params: { network, hash: v } });
    } else if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
      navigate({ to: "/explorer/$network/address/$hash", params: { network, hash: v } });
    } else if (/^\d+$/.test(v)) {
      navigate({ to: "/explorer/$network/block/$height", params: { network, height: v } });
    } else {
      toast.error("Enter a transaction hash, address, or block number");
    }
  };

  return (
    <form onSubmit={submit} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
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
  );
}
