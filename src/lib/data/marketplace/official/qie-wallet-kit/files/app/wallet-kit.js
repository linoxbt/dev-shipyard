// QIE Wallet Kit: wallet components for preact + htm apps on QIE Mainnet.
//
//   useWallet()                 account, chain, connect, switch, errors
//   <ConnectButton wallet />    connect, or the connected address
//   <NetworkGuard wallet>       a switch-network banner until on QIE Mainnet
//   <AddressChip address />     short address, copy, explorer link
//   <BalanceBadge address />    QIE, or any ERC-20 with `token`
//
// Styles live in wallet-kit.css, every class prefixed `ds-` so they do not
// collide with yours. Works in DevStation's preview through wallet.js.

import { html } from "htm/preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { createPublicClient, formatUnits, http } from "viem";
import { CHAIN, ERC20_ABI, explorerAddress, viemChain } from "./contract.js";
import {
  connect,
  currentAccount,
  currentChainId,
  hasWallet,
  isEmbedded,
  onWalletChange,
  switchToAppChain,
} from "./wallet.js";

/** One client for reads, shared by every component. */
export const publicClient = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function formatToken(value, decimals, places = 4) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, places).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

/** The wallet's state, kept current. Pass the result to the components. */
export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setAccount(await currentAccount());
    setChainId(await currentChainId());
  }, []);

  useEffect(() => {
    void refresh();
    const stop = onWalletChange(refresh);
    // DevStation's preview bridge sends no events; poll gently there instead.
    const timer = isEmbedded ? setInterval(refresh, 4000) : null;
    return () => {
      stop();
      if (timer) clearInterval(timer);
    };
  }, [refresh]);

  const doConnect = useCallback(async () => {
    setError("");
    setConnecting(true);
    try {
      await connect();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "The wallet did not connect.");
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const switchChain = useCallback(async () => {
    setError("");
    try {
      await switchToAppChain();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "The network did not switch.");
    }
  }, [refresh]);

  return {
    account,
    chainId,
    onChain: chainId === CHAIN.id,
    available: hasWallet(),
    connecting,
    error,
    connect: doConnect,
    switchChain,
    refresh,
  };
}

export function ConnectButton({ wallet, label = "Connect wallet" }) {
  if (!wallet.available) return html`<span class="ds-chip ds-muted">No wallet found</span>`;
  if (wallet.account) return html`<${AddressChip} address=${wallet.account} />`;
  return html`
    <button class="ds-btn" onClick=${wallet.connect} disabled=${wallet.connecting}>
      ${wallet.connecting ? "Connecting…" : label}
    </button>
  `;
}

export function NetworkGuard({ wallet, children }) {
  if (wallet.account && wallet.chainId !== null && !wallet.onChain) {
    return html`
      <div class="ds-banner" role="alert">
        <span>Your wallet is on another network. This app runs on ${CHAIN.name}.</span>
        <button class="ds-btn" onClick=${wallet.switchChain}>Switch to ${CHAIN.name}</button>
      </div>
    `;
  }
  return children;
}

export function AddressChip({ address, copy = true }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const onCopy = () => {
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return html`
    <span class="ds-chip" title=${address}>
      <a href=${explorerAddress(address)} target="_blank" rel="noreferrer">${shortAddress(address)}</a>
      ${copy && html`<button class="ds-link" onClick=${onCopy}>${copied ? "copied" : "copy"}</button>`}
    </span>
  `;
}

/** QIE by default; pass `token={{ address, symbol, decimals }}` for an ERC-20. */
export function BalanceBadge({ address, token, refreshMs = 15000 }) {
  const [value, setValue] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    const read = async () => {
      try {
        const next = token
          ? await publicClient.readContract({
              address: token.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            })
          : await publicClient.getBalance({ address });
        if (alive) {
          setValue(next);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void read();
    const timer = setInterval(read, refreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address, token?.address, refreshMs]);

  if (!address) return null;
  const symbol = token?.symbol ?? CHAIN.symbol;
  const decimals = token?.decimals ?? 18;
  return html`
    <span class="ds-badge">
      ${failed ? "unavailable" : value === null ? "…" : formatToken(value, decimals)}
      <span class="ds-muted"> ${symbol}</span>
    </span>
  `;
}
