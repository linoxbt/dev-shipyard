import { Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { truncateAddress } from "@/lib/wallet";
import { useActiveChain } from "@/hooks/useActiveChain";
import { slugForChainId } from "@/lib/explorer/network";
import { useChainLabel } from "@/components/shared/useChainLabel";
import { cn } from "@/lib/utils";

interface Props {
  address: string;
  showLabel?: boolean;
  full?: boolean;
  className?: string;
  /** The chain the address lives on. Defaults to the selected network. */
  chainId?: number;
}

export function AddressChip({
  address,
  showLabel = true,
  full = false,
  className,
  chainId: chainIdProp,
}: Props) {
  const [copied, setCopied] = useState(false);
  const { chainId: selectedChainId } = useActiveChain();
  const chainId = chainIdProp ?? selectedChainId;
  const network = slugForChainId(chainId);
  // Real on-chain names from ContractLabelRegistry. useAllLabels underneath is
  // a shared React Query key with a 15s staleTime, so the many AddressChips on
  // a Routebook call tree all read one cached fetch rather than one each.
  const label = useChainLabel(showLabel ? address : undefined, chainId);

  const copy = () => {
    navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard blocked: the address is still on screen to select */
      });
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      {label ? (
        // A community label is anyone's claim, made first: marked so it never
        // reads as the contract's verified name.
        <span
          className={label.trusted ? "text-info" : "text-muted-foreground"}
          title={label.trusted ? address : `${address}\nCommunity label, not verified`}
        >
          {label.name}
          {!label.trusted && (
            <span className="ml-0.5 align-super text-[9px] text-warning" aria-label="unverified">
              ?
            </span>
          )}
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
