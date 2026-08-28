import { Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { truncateAddress } from "@/lib/wallet";
import { useActiveChain } from "@/hooks/useActiveChain";
import { slugForChainId } from "@/lib/explorer/network";
import { useLabelName } from "@/hooks/useContractLabels";
import { cn } from "@/lib/utils";

interface Props {
  address: string;
  showLabel?: boolean;
  full?: boolean;
  className?: string;
}

export function AddressChip({ address, showLabel = true, full = false, className }: Props) {
  const [copied, setCopied] = useState(false);
  const { chainId } = useActiveChain();
  const network = slugForChainId(chainId);
  // Real on-chain names from ContractLabelRegistry. useAllLabels underneath is
  // a shared React Query key with a 15s staleTime, so the many AddressChips on
  // a Routebook call tree all read one cached fetch rather than one each.
  const onChainName = useLabelName(showLabel ? address : undefined);
  const label = onChainName ? { name: onChainName } : undefined;

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
      <Link
        to="/explorer/$network/address/$hash"
        params={{ network, hash: address }}
        className="text-meta transition hover:text-muted-foreground"
        aria-label="View on DevStation explorer"
      >
        <ExternalLink className="h-3 w-3" />
      </Link>
    </span>
  );
}
