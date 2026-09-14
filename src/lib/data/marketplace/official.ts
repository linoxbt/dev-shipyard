import type { ListingKind } from "@/lib/marketplace/listing";

// Official marketplace listings that are not contract templates: apps, agent
// skills and UI kits that ship with DevStation, free for everyone.
//
// Their files live beside this module under official/<slug>/files and are
// loaded on demand by official-files.ts. Everything here is presentation: the
// name, what it is, and how to start using it.

export interface GettingStartedStep {
  title: string;
  body: string;
  code?: string;
}

export interface OfficialListing {
  slug: string;
  kind: Exclude<ListingKind, "template">;
  name: string;
  description: string;
  readme: string;
  category: string;
  tags: string[];
  version: string;
  /** For skills: the folder name, which is also the name the agent calls it by. */
  skillName?: string;
  gettingStarted: GettingStartedStep[];
}

const APP_STEPS = (extra: GettingStartedStep[]): GettingStartedStep[] => [
  {
    title: "Clone it",
    body: "Press Clone into my apps. A copy opens in the App Builder under your apps, and previews at once with the wallet you connected to DevStation.",
  },
  ...extra,
  {
    title: "Make it yours",
    body: "Edit app.js and styles.css in the App Builder, or describe the change to its AI. contract.js holds the QIE Mainnet settings.",
  },
  {
    title: "Put it online",
    body: "Publish from the App Builder to give it its own web address. Or download it and serve the app folder over HTTP: opening index.html from disk does not work, because browsers block ES modules on file://.",
    code: "npx serve app",
  },
];

const KIT_STEPS = (files: string, snippet: string): GettingStartedStep[] => [
  {
    title: "See it working",
    body: "Press Clone into my apps to open the kit's demo in the App Builder, where every component previews against QIE Mainnet.",
  },
  {
    title: "Copy the kit into your app",
    body: `Copy ${files} into your app folder. An App Builder app already has wallet.js and contract.js: keep yours, and check contract.js has the exports named in the kit's README.`,
  },
  {
    title: "Import the components",
    body: "Link the kit's stylesheet in index.html, then import what you need.",
    code: snippet,
  },
  {
    title: "Theme it",
    body: "Every class is prefixed ds-. Set --ds-brand, --ds-text, --ds-surface and the other --ds- variables on :root to match your app.",
  },
];

export const OFFICIAL_LISTINGS: readonly OfficialListing[] = [
  {
    slug: "qie-portfolio",
    kind: "app",
    name: "QIE Portfolio",
    description:
      "See what any wallet holds on QIE Mainnet, read straight from chain: QIE, QUSDC and QIE ID tokens, for the connected wallet or any address.",
    readme:
      "A complete, working app for looking at holdings on QIE Mainnet. It connects the wallet you use in DevStation, or looks up any address you paste, and reads balances from the QIE RPC: native QIE, QUSDC with its 6 decimals, and the number of QIE ID tokens held, with the block they were read at and explorer links.\n\nBuilt with preact, htm and viem through an import map: no build step and nothing to install. A good first app to clone and extend with the tokens you care about.",
    category: "Wallets",
    tags: ["portfolio", "balances", "qusdc", "qie-id"],
    version: "1.0.0",
    gettingStarted: APP_STEPS([
      {
        title: "Try it",
        body: "Connect your wallet in the preview, or paste any QIE address into the lookup box. Balances are read from QIE Mainnet as you watch.",
      },
    ]),
  },
  {
    slug: "qie-pay-link",
    kind: "app",
    name: "QIE Pay Link",
    description:
      "Request a payment in QIE or QUSDC with a link, and pay one: the payer's wallet is moved to QIE Mainnet, the balance is checked, and the receipt is confirmed.",
    readme:
      "Ask anyone for QIE or QUSDC with a link. A request is only the link: ?to=<address>&amount=<number>&token=QIE|QUSDC&memo=<note>, and nothing is stored anywhere.\n\nWhoever opens it connects a wallet, is moved to QIE Mainnet, has their balance checked, and pays. The app waits for the transaction's receipt and reports Paid only when it succeeded. QUSDC transfers carry an explicit gas limit, because QIE's gas estimate is too low for token writes.",
    category: "Payments",
    tags: ["payments", "qusdc", "links", "invoices"],
    version: "1.0.0",
    gettingStarted: APP_STEPS([
      {
        title: "Create a request",
        body: "In the preview, enter the receiving address, an amount and QIE or QUSDC, then Create link. Open as the payer shows exactly what the person paying will see.",
      },
      {
        title: "Share real links",
        body: "Inside the preview the page has no public address, so the link is the part after it. Once published, Copy link gives a full link that works anywhere.",
        code: "https://your-app.devstation.online/?to=0x…&amount=25&token=QUSDC&memo=Invoice%201042",
      },
    ]),
  },
  {
    slug: "qie-deploy",
    kind: "skill",
    name: "QIE Deploy",
    skillName: "qie-deploy",
    description:
      "An agent skill for deploying and verifying Solidity contracts on QIE Mainnet or Testnet with Foundry or Hardhat, avoiding QIE's gas-estimate and MCOPY pitfalls.",
    readme:
      "Teaches the DevStation agent, or Claude Code, to deploy contracts to QIE the way that actually works.\n\nIt carries the checked network facts (chain IDs 1990 and 1983, RPCs, explorers), and the two things that differ from Ethereum: QIE's EVM has no MCOPY, so compile for Shanghai, and eth_estimateGas is too low for storage writes, so every deployment gets an explicit gas limit and a receipt check. It deploys to Testnet first, confirms code at the address, verifies the source on QIE's Blockscout explorer, and reports the address and links. Includes foundry.toml and hardhat.config.ts ready for QIE.",
    category: "Deployment",
    tags: ["deploy", "foundry", "hardhat", "verification"],
    version: "1.0.0",
    gettingStarted: [
      {
        title: "What the agent will do",
        body: "Check your toolchain, set evm_version to shanghai, keep your key in the environment, build and test, deploy to QIE Testnet with an explicit gas limit, confirm the receipt and the code, verify on the explorer, and give you the address and links. It asks before any Mainnet deployment.",
      },
      {
        title: "Ask for a deployment",
        body: "With the skill installed, name the contract and the network.",
        code: '/qie-deploy deploy src/MyToken.sol to QIE Testnet with the name "My Token" and symbol MTK',
      },
    ],
  },
  {
    slug: "qie-dapp-frontend",
    kind: "skill",
    name: "QIE dApp Frontend",
    skillName: "qie-dapp-frontend",
    description:
      "An agent skill for wiring web apps to QIE with viem or wagmi: chain definitions, adding the network to wallets, QUSDC decimals, QIE ID names and safe writes.",
    readme:
      "Teaches the DevStation agent, or Claude Code, to connect a web app to QIE correctly.\n\nIt covers chain definitions for QIE Mainnet and Testnet (with Testnet's fallback RPC), switching or adding the network in the wallet, reading QUSDC with its 6 decimals, writes with explicit gas limits and receipt checks, explorer links, and showing .qie names honestly: from the registration that minted each token, never QIE's free placeholder names. Includes chains.ts with viem chains, QUSDC and QIE ID addresses, and a wagmi config.",
    category: "Frontend",
    tags: ["viem", "wagmi", "wallets", "qie-id"],
    version: "1.0.0",
    gettingStarted: [
      {
        title: "What the agent will do",
        body: "Add QIE chain definitions, make the wallet switch to or add QIE, read token amounts with their real decimals, send writes with explicit gas and check receipts, and link to the explorer. The skill's checklist is how it decides the work is done.",
      },
      {
        title: "Ask for the change",
        body: "With the skill installed, say what the app needs.",
        code: "/qie-dapp-frontend add QIE Mainnet to this React app and show the connected wallet's QUSDC balance",
      },
    ],
  },
  {
    slug: "qie-wallet-kit",
    kind: "ui-kit",
    name: "QIE Wallet Kit",
    description:
      "Wallet components for preact + htm apps on QIE Mainnet: a connect button, a switch-network guard, address chips and live balance badges.",
    readme:
      "Drop-in wallet UI for apps on QIE Mainnet, built with preact and htm like DevStation's App Builder apps.\n\nuseWallet keeps the account and chain current. ConnectButton connects, or shows the address once connected. NetworkGuard shows a one-click switch until the wallet is on QIE Mainnet, adding the network if the wallet lacks it. AddressChip gives a short address with copy and explorer link, and BalanceBadge a live QIE or ERC-20 balance. It works in published apps through window.ethereum and inside DevStation's preview through its wallet bridge. Styles are prefixed ds- and themeable with CSS variables.",
    category: "Wallets",
    tags: ["wallet", "connect", "network", "preact"],
    version: "1.0.0",
    gettingStarted: KIT_STEPS(
      "wallet-kit.js, wallet-kit.css, wallet.js and contract.js",
      'import { useWallet, ConnectButton, NetworkGuard, BalanceBadge } from "./wallet-kit.js";\n\nconst wallet = useWallet();\nhtml`<${ConnectButton} wallet=${wallet} />\n<${NetworkGuard} wallet=${wallet}>\n  <${BalanceBadge} address=${wallet.account} />\n</${NetworkGuard}>`;',
    ),
  },
  {
    slug: "qie-tx-kit",
    kind: "ui-kit",
    name: "QIE Transaction Kit",
    description:
      "Send, follow and report transactions on QIE Mainnet: a transaction button with live status, receipt checks that catch reverts, toasts and explorer links.",
    readme:
      "Transaction UI that tells people what really happened. sendTransaction connects if needed, moves the wallet to QIE Mainnet and sends. waitForSuccess resolves only when the receipt says success, so a mined but reverted transaction is reported as the failure it is.\n\nuseTransaction tracks signing, pending, success and failed. TxButton runs the whole flow with a status line, TxStatus shows where it got to, Toaster and toast give notifications, and ExplorerLink links the QIE explorer. Wallet rejections return to idle quietly. Built with preact, htm and viem.",
    category: "Transactions",
    tags: ["transactions", "receipts", "toasts", "preact"],
    version: "1.0.0",
    gettingStarted: KIT_STEPS(
      "tx-kit.js, tx-kit.css, wallet.js and contract.js",
      'import { TxButton, Toaster } from "./tx-kit.js";\n\nconst claim = { to: CONTRACT, data: encodeFunctionData({ abi, functionName: "claim" }), gas: 200000n };\nhtml`<${TxButton} tx=${claim} label="Claim" /><${Toaster} />`;',
    ),
  },
];

export function getOfficialListing(slug: string): OfficialListing | null {
  return OFFICIAL_LISTINGS.find((item) => item.slug === slug) ?? null;
}
