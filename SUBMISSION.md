# DevStation — QIE Hackathon Submission

> The complete developer console for the QIE blockchain. Write, deploy, debug,
> and understand smart contracts from a single browser tab, fully onchain.

---

## 1. Basic Info

| Field | Value |
|---|---|
| **Team Name** | _[your team / handle]_ |
| **Project Name** | DevStation |
| **Project Category** | Developer Tooling / Infrastructure |
| **Live App** | https://devstation.online |

### Project Description

DevStation is the complete developer console for the QIE blockchain. It brings
everything a builder needs to write, deploy, debug, and understand smart
contracts into a single web app, with no setup and no backend, all running
against the live QIE chain.

The platform unifies seven tools that usually live in separate products:

- **Code with AI** — an autonomous build agent. Describe a contract in plain
  English and it generates production-grade Solidity, compiles it in the
  browser, fixes its own compiler errors (up to five attempts), then deploys it
  with your wallet. When a constructor needs values, you get a form to review
  and confirm before signing. It also audits any contract you paste, grading
  findings by severity (Critical through Gas).
- **Contract Editor** — a full in-browser Solidity IDE with a Monaco editor,
  multi-version solc compilation, automatic OpenZeppelin import resolution,
  static analysis, and an interactive command terminal.
- **LaunchKit Templates** — audited, ready-to-deploy contracts (ERC-20, NFT,
  Soulbound NFT, MultiSig, Timelock, Vesting, Staking, Payment Splitter) with
  live onchain deploy counts and a guided deployment flow.
- **Inspect (Routebook)** — a transaction decoder that turns any tx hash into a
  human-readable execution map: named contracts, decoded methods and arguments,
  token movements, and approval risk flags, with revert reasons on failure.
- **QIE Explorer** — a native block explorer with live price, gas, and network
  stats, plus full transaction, block, address, and token pages across Testnet
  and Mainnet.
- **Label Registry** — onchain, human-readable names for contracts, shared
  across the ecosystem and powering the named contracts shown in Inspect.
- **My Projects & Activity** — personal and ecosystem-wide deployment history,
  recorded onchain in a Project Registry.

DevStation is genuinely onchain: every deployment is recorded to onchain
registries, all reads come from live QIE RPC, and it ships as an installable
PWA. It lowers the barrier to building on QIE from hours of local setup to a
single browser tab.

---

## 2. Links

| Field | Value |
|---|---|
| **Live App / Demo** | https://devstation.online |
| **GitHub Repo** | https://github.com/linoxbt/dev-shipyard |
| **Demo Video** | _[paste your video URL once recorded]_ |
| **Docs** | https://devstation.online/docs |

---

## 3. Social

- **X / Twitter:** _[your handle]_
- Launch thread covering Code with AI, Inspect, QIE Explorer, Contract Editor,
  Templates, and the Label Registry.

---

## 4. Wallet

Connect and verify the QIE wallet you control (the deployer wallet used for
DevStation). It must match the address shown on the **My Projects** page so
judges can tie the submission to real onchain deployments.

---

## 5. Review — One-line summary

DevStation: the all-in-one developer console for QIE. Generate, deploy, inspect,
and explore smart contracts from a single browser tab, fully onchain.

---

## Tech Stack

- **Frontend:** TanStack Start (SSR + file-based routing), React 19, Tailwind v4,
  Zustand, TanStack Query
- **Onchain:** viem / wagmi against live QIE Testnet and Mainnet RPC
- **Compilation:** solc running in a browser Web Worker, with OpenZeppelin v5
  imports resolved from CDN
- **AI:** pluggable provider (Anthropic / OpenAI-compatible / OpenRouter) via a
  server proxy, with a text-protocol agent loop driving compile + deploy tools
- **Onchain registries:** ProjectRegistry (deployments) and
  ContractLabelRegistry (labels), deployed on QIE
- **Delivery:** installable PWA, deployed on Netlify

## What Makes It Unique

- An AI agent that does not just suggest code — it generates, compiles,
  self-corrects, and deploys end to end, without leaving the page.
- A transaction inspector that reads bytecode the way a human would: named
  contracts, decoded calls, token flows, and risk flags — not raw selectors.
- Everything is real: live RPC, real deployments, and onchain registries that
  the whole ecosystem can read.

## What's Next

- Onchain source verification once QIE's verifier supports it.
- Multi-file project deploys and richer template categories.
- Deeper analytics on the Explorer and ecosystem Activity feed.

---

_Built for the QIE Hackathon. © 2026 DevStation. MIT licensed._
