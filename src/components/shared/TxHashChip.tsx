import { Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { truncateHash } from "@/lib/wallet";
import { useActiveChain } from "@/hooks/useActiveChain";
import { cn } from "@/lib/utils";

export function TxHashChip({ hash, className }: { hash: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { config } = useActiveChain();

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs text-code", className)}>
      <span>{truncateHash(hash)}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(hash);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-meta transition hover:text-muted-foreground"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
      <a
        href={`${config.explorerUrl}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="text-meta transition hover:text-muted-foreground"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  );
}
