import { Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { truncateAddress } from "@/lib/wallet";
import { useActiveChain } from "@/hooks/useActiveChain";
import { findLabel } from "@/lib/mock/labels";
import { cn } from "@/lib/utils";

interface Props {
  address: string;
  showLabel?: boolean;
  full?: boolean;
  className?: string;
}

export function AddressChip({ address, showLabel = true, full = false, className }: Props) {
  const [copied, setCopied] = useState(false);
  const { config } = useActiveChain();
  const label = showLabel ? findLabel(address) : undefined;

  const copy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      {label ? (
        <span className="text-info" title={address}>
          {label.name}
        </span>
      ) : (
        <span className="text-foreground">{full ? address : truncateAddress(address)}</span>
      )}
      <button
        onClick={copy}
        className="text-meta transition hover:text-muted-foreground"
        aria-label="Copy address"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
      <a
        href={`${config.explorerUrl}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="text-meta transition hover:text-muted-foreground"
        aria-label="View on explorer"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  );
}
