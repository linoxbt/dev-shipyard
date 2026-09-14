# QIE Token Form Kit

The parts of a form that move tokens on QIE Mainnet, done carefully. Amounts are bigints in the token's smallest unit from the moment they are typed: no floating point anywhere, so a QUSDC amount (6 decimals) and a QIE amount (18) are always exact.

| Export | What it does |
| --- | --- |
| `parseAmount(text, decimals)` | `{ value, error }`: rejects letters and too many decimals |
| `formatAmount(value, decimals)` | For display |
| `<AmountInput token value onInput balance>` | Balance, a Max button, and inline errors for bad input or more than the balance |
| `<TokenSelect tokens value onChange allowCustom>` | QIE, QUSDC, or any token pasted by address (its symbol and decimals are read from chain) |
| `loadToken(address)` | Name, symbol, decimals of an ERC-20 |
| `useTokenBalance(owner, token)` | Live balance, QIE or ERC-20 |
| `useAllowance(owner, token, spender)` | Current allowance |
| `sendToken({ token, to, amount })` | Sends QIE or an ERC-20; resolves only on a successful receipt |
| `approveToken({ token, spender, amount })` | Approves exactly `amount` |
| `<ApproveThenAct owner token spender amount actLabel buildTx onDone>` | The approve-then-deposit flow: approves only if the allowance is short, then sends `buildTx()` |

ERC-20 writes send a 150,000 gas limit (`TOKEN_WRITE_GAS` in `contract.js`), because QIE's gas estimate is too low for storage writes. Unused gas is refunded.

## Add it to an app

1. Copy `token-form-kit.js`, `token-form-kit.css`, `wallet.js` and `contract.js` into your app folder. An App Builder app already has `wallet.js` and `contract.js`: make sure `contract.js` exports `CHAIN`, `ERC20_ABI`, `QUSDC`, `TOKEN_WRITE_GAS`, `explorerTx` and `viemChain`.
2. Add `<link rel="stylesheet" href="./token-form-kit.css" />`.
3. Build the form:

```js
import { encodeFunctionData } from "viem";
import { AmountInput, ApproveThenAct, DEFAULT_TOKENS, parseAmount, useTokenBalance } from "./token-form-kit.js";

function Deposit({ account }) {
  const token = DEFAULT_TOKENS[1]; // QUSDC
  const [text, setText] = useState("");
  const { balance } = useTokenBalance(account, token);
  const amount = parseAmount(text, token.decimals).value;
  return html`
    <${AmountInput} token=${token} value=${text} onInput=${setText} balance=${balance} />
    <${ApproveThenAct}
      owner=${account} token=${token} spender=${VAULT} amount=${amount} actLabel="Deposit"
      buildTx=${() => ({ to: VAULT, gas: "0x30d40", data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amount] }) })}
    />
  `;
}
```

## Demo

`app.js` has a working send form (QIE, QUSDC or any token) and the approval flow. In DevStation, **Clone into my apps** previews it with the wallet you connected.
