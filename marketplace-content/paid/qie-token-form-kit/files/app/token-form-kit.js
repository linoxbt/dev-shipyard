// QIE Token Form Kit: the parts of a form that move tokens, done carefully.
//
//   parseAmount(text, decimals)      { value, error }: exact, decimal-aware
//   loadToken(address)               { address, name, symbol, decimals }
//   useTokenBalance(owner, token)    live balance of QIE or an ERC-20
//   useAllowance(owner, token, spender)
//   <AmountInput token value onInput balance />     with Max and inline errors
//   <TokenSelect tokens value onChange allowCustom />
//   sendToken({ token, to, amount })  QIE or ERC-20, waits for a successful receipt
//   approveToken({ token, spender, amount })
//   <ApproveThenAct token spender amount actLabel buildTx onDone />
//
// Amounts are bigints in the token's smallest unit from the moment they are
// typed: no floating point anywhere, so 0.1 + 0.2 stays exactly 0.3.

import { html } from "htm/preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  toHex,
} from "viem";
import { CHAIN, ERC20_ABI, QUSDC, TOKEN_WRITE_GAS, explorerTx, viemChain } from "./contract.js";
import { connect, currentAccount, currentChainId, request, switchToAppChain } from "./wallet.js";

export const publicClient = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

/** QIE itself has no contract address. */
export const NATIVE = { address: null, name: "QIE", symbol: "QIE", decimals: 18 };
export const DEFAULT_TOKENS = [NATIVE, { ...QUSDC, name: "QUSDC" }];

export function parseAmount(text, decimals) {
  const value = String(text ?? "").trim();
  if (!value) return { value: null, error: "" };
  if (!/^\d*\.?\d*$/.test(value) || value === ".") return { value: null, error: "Numbers only" };
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals) return { value: null, error: `At most ${decimals} decimals` };
  return { value: parseUnits(value.endsWith(".") ? value.slice(0, -1) : value, decimals), error: "" };
}

export function formatAmount(value, decimals, places = 6) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, places).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

export async function loadToken(address) {
  if (!isAddress(address)) throw new Error("Not a contract address");
  const call = (functionName) => publicClient.readContract({ address, abi: ERC20_ABI, functionName });
  try {
    const [name, symbol, decimals] = await Promise.all([call("name"), call("symbol"), call("decimals")]);
    return { address, name, symbol, decimals: Number(decimals) };
  } catch {
    throw new Error("That address is not an ERC-20 token on QIE Mainnet");
  }
}

async function balanceOf(owner, token) {
  return token.address
    ? publicClient.readContract({ address: token.address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
    : publicClient.getBalance({ address: owner });
}

export function useTokenBalance(owner, token, refreshMs = 15000) {
  const [balance, setBalance] = useState(null);
  const reload = useCallback(async () => {
    if (!owner || !token) return setBalance(null);
    try {
      setBalance(await balanceOf(owner, token));
    } catch {
      setBalance(null);
    }
  }, [owner, token?.address, token?.symbol]);
  useEffect(() => {
    void reload();
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs]);
  return { balance, reload };
}

export function useAllowance(owner, token, spender) {
  const [allowance, setAllowance] = useState(null);
  const reload = useCallback(async () => {
    if (!owner || !token?.address || !isAddress(spender ?? "")) return setAllowance(null);
    try {
      setAllowance(
        await publicClient.readContract({
          address: token.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, spender],
        }),
      );
    } catch {
      setAllowance(null);
    }
  }, [owner, token?.address, spender]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { allowance, reload };
}

export function AmountInput({ token, value, onInput, balance, label = "Amount" }) {
  const { value: parsed, error } = parseAmount(value, token.decimals);
  const tooMuch = parsed !== null && balance != null && parsed > balance;
  return html`
    <label class="ds-field">
      <span class="ds-field-top">
        <span>${label}</span>
        ${balance != null && html`<span class="ds-muted">Balance ${formatAmount(balance, token.decimals)} ${token.symbol}</span>`}
      </span>
      <span class="ds-amount">
        <input inputmode="decimal" autocomplete="off" placeholder="0.0" value=${value} onInput=${(e) => onInput(e.currentTarget.value.replace(",", "."))} />
        <span class="ds-muted">${token.symbol}</span>
        ${balance != null && html`<button type="button" class="ds-link" onClick=${() => onInput(formatUnits(balance, token.decimals))}>Max</button>`}
      </span>
      ${(error || tooMuch) && html`<span class="ds-field-error">${error || "More than your balance"}</span>`}
    </label>
  `;
}

export function TokenSelect({ tokens = DEFAULT_TOKENS, value, onChange, allowCustom = true }) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const key = (t) => t.address ?? "native";

  const addCustom = async () => {
    setError("");
    setLoading(true);
    try {
      onChange(await loadToken(custom.trim()));
      setCustom("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const options = value && !tokens.some((t) => key(t) === key(value)) ? [...tokens, value] : tokens;
  return html`
    <div class="ds-field">
      <span class="ds-field-top"><span>Token</span></span>
      <select value=${value ? key(value) : ""} onChange=${(e) => onChange(options.find((t) => key(t) === e.currentTarget.value))}>
        ${options.map((t) => html`<option value=${key(t)}>${t.symbol}${t.address ? ` · ${t.address.slice(0, 6)}…${t.address.slice(-4)}` : ""}</option>`)}
      </select>
      ${allowCustom && html`
        <span class="ds-amount">
          <input placeholder="Or paste a token address" value=${custom} onInput=${(e) => setCustom(e.currentTarget.value)} />
          <button type="button" class="ds-link" disabled=${loading || !isAddress(custom.trim())} onClick=${addCustom}>${loading ? "Loading…" : "Use"}</button>
        </span>`}
      ${error && html`<span class="ds-field-error">${error}</span>`}
    </div>
  `;
}

async function sendAndConfirm(tx) {
  const from = (await currentAccount()) ?? (await connect());
  if (!from) throw new Error("Connect a wallet first.");
  if ((await currentChainId()) !== CHAIN.id) await switchToAppChain();
  const hash = await request("eth_sendTransaction", [{ from, value: "0x0", ...tx }]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    const error = new Error("The transaction was mined but reverted.");
    error.hash = hash;
    throw error;
  }
  return hash;
}

/** Sends QIE or an ERC-20. `amount` is a bigint in the token's smallest unit. */
export function sendToken({ token, to, amount }) {
  if (!isAddress(to)) throw new Error("Enter a valid recipient address.");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("Enter an amount above zero.");
  if (!token.address) return sendAndConfirm({ to, value: toHex(amount) });
  return sendAndConfirm({
    to: token.address,
    gas: toHex(TOKEN_WRITE_GAS),
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, amount] }),
  });
}

/** Approves exactly `amount`: the least a spender needs, not unlimited. */
export function approveToken({ token, spender, amount }) {
  return sendAndConfirm({
    to: token.address,
    gas: toHex(TOKEN_WRITE_GAS),
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }),
  });
}

/**
 * The two-step flow every ERC-20 deposit needs: approve the spender if its
 * allowance is short, then run the action. `buildTx()` returns the action's
 * transaction ({ to, data, gas }), sent once the allowance covers `amount`.
 */
export function ApproveThenAct({ owner, token, spender, amount, actLabel, buildTx, onDone }) {
  const { allowance, reload } = useAllowance(owner, token, spender);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const needsApproval = token.address && amount != null && allowance != null && allowance < amount;

  const step = async (label, fn) => {
    setMessage("");
    setBusy(label);
    try {
      const hash = await fn();
      setMessage(html`${label} confirmed: <a href=${explorerTx(hash)} target="_blank" rel="noreferrer">view</a>`);
      await reload();
      return hash;
    } catch (e) {
      setMessage(html`<span class="ds-field-error">${e.message.split("\n")[0]}</span>`);
      return null;
    } finally {
      setBusy("");
    }
  };

  const disabled = !!busy || !owner || !isAddress(spender ?? "") || amount == null || amount <= 0n;
  return html`
    <div class="ds-flow">
      <ol class="ds-steps">
        <li class=${!needsApproval ? "ds-done" : ""}>Approve ${token.symbol}${allowance != null ? ` (allowed: ${formatAmount(allowance, token.decimals)})` : ""}</li>
        <li>${actLabel}</li>
      </ol>
      ${needsApproval
        ? html`<button class="ds-btn" disabled=${disabled} onClick=${() => step("Approval", () => approveToken({ token, spender, amount }))}>
            ${busy === "Approval" ? "Approving…" : `Approve ${formatAmount(amount, token.decimals)} ${token.symbol}`}
          </button>`
        : html`<button class="ds-btn" disabled=${disabled || allowance == null} onClick=${async () => {
            const hash = await step(actLabel, async () => sendAndConfirm(await buildTx()));
            if (hash) onDone?.(hash);
          }}>
            ${busy === actLabel ? "Working…" : actLabel}
          </button>`}
      ${message && html`<p class="ds-muted">${message}</p>`}
    </div>
  `;
}
