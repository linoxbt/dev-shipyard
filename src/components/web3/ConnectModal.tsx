import { useState } from "react";
import { Wallet, Plus, X } from "lucide-react";
import { useConnect, type Connector } from "wagmi";
import { GenerateWalletDialog } from "./GenerateWalletDialog";

// Lightweight connect picker that replaces the RainbowKit modal. It lists the
// injected connectors wagmi discovers (QIE Wallet, MetaMask, …) plus the in-app
// generated wallet. QIE Wallet appears automatically when its extension is
// installed (EIP-6963 discovery).
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();
  const [showGenerate, setShowGenerate] = useState(false);

  // Exclude the burner (it has its own create/unlock flow) and dedupe by name.
  const seen = new Set<string>();
  const external = connectors.filter((c) => {
    if (c.id === "devstation-burner") return false;
    const key = c.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (showGenerate) {
    return <GenerateWalletDialog onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-base font-bold text-foreground">Connect a Wallet</h2>
          <button onClick={onClose} className="text-meta hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {external.length === 0 && (
            <p className="rounded border border-border bg-background p-3 font-mono text-[11px] text-meta">
              No browser wallet detected. Install the{" "}
              <a
                href="https://chromewebstore.google.com/detail/qie-wallet-and-web3-domai/oljchdcgmibnjbbopolafbjncfhdacjb"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                QIE Wallet extension
              </a>
              , or generate one below.
            </p>
          )}
          {external.map((c) => (
            <ConnectorRow
              key={c.uid}
              connector={c}
              pending={isPending}
              onClick={() => connect({ connector: c }, { onSuccess: onClose })}
            />
          ))}

          <button
            onClick={() => setShowGenerate(true)}
            className="flex w-full items-center gap-3 rounded border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded bg-primary/15 text-primary">
              <Plus className="h-4 w-4" />
            </span>
            <span>
              <span className="block font-mono text-xs font-medium text-foreground">
                Generate DevStation Wallet
              </span>
              <span className="block font-mono text-[10px] text-meta">
                In-app, password-encrypted. Great for testnet.
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectorRow({
  connector,
  pending,
  onClick,
}: {
  connector: Connector;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-center gap-3 rounded border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50 disabled:opacity-50"
    >
      {connector.icon ? (
        <img src={connector.icon} alt="" className="h-7 w-7 rounded" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-surface-2 text-muted-foreground">
          <Wallet className="h-4 w-4" />
        </span>
      )}
      <span className="font-mono text-xs font-medium text-foreground">{connector.name}</span>
    </button>
  );
}
