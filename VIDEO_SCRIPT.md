# DevStation — 3-Minute Demo Video Script

Total runtime: **3:00**. Narration paced at ~150 words/minute so the words fit
the time. Each block has a **timecode**, **ON SCREEN** (what to do / click), and
**VOICEOVER** (what the voice says).

## How to produce this video

The script and the screen recording are separate; a video editor marries them.

1. **Record the screen** following the ON SCREEN cues — OBS Studio (free), Loom,
   or Screen Studio (Mac, cleanest result). Record silent, slightly slower than
   feels natural.
2. **Generate the voice** from the VOICEOVER lines with a text-to-speech tool
   like ElevenLabs. Generate each block as its OWN clip so it snaps to the
   matching moment. ElevenLabs only reads text you paste — it cannot access the
   website or record anything.
3. **Assemble** in CapCut (free) or DaVinci Resolve: screen recording on the
   timeline, voice clips at the timecodes below, low background music.
4. **Captions:** auto-generate in CapCut, or use the TTS lines below.

**Setup before recording:** wallet connected, on QIE Testnet, browser at
1920x1080, clean profile, one ERC-20 demo tx hash ready for Inspect.

---

## Script

### 0:00–0:12 — Landing (`/`)
- **ON SCREEN:** Open https://devstation.online. Slow scroll the hero, pause on
  the feature grid.
- **VOICEOVER:** "This is DevStation. The complete developer console for the QIE
  blockchain. Write, deploy, debug, and inspect contracts, all in one place, all
  onchain. Let me show you around."

### 0:12–0:24 — Overview (`/overview`)
- **ON SCREEN:** Enter the app. Pan across the ecosystem stat cards and live
  feeds.
- **VOICEOVER:** "The Overview is your home base. Live ecosystem stats, total
  deployments, unique builders, and network activity, all read straight from the
  chain."

### 0:24–0:40 — LaunchKit Templates (`/launchkit/templates`)
- **ON SCREEN:** Open Templates. Hover the gallery. Open ERC-20, scroll the
  source and ABI tabs.
- **VOICEOVER:** "LaunchKit Templates are audited, ready to ship. ERC-20, NFT,
  MultiSig, Timelock, Staking, and more. Every template shows its real onchain
  deploy count, with full source and ABI before you commit."

### 0:40–0:52 — Deploy flow (`/launchkit/deploy`)
- **ON SCREEN:** Click Deploy. Show the guided constructor form, fill a field,
  point at the compile-then-deploy steps.
- **VOICEOVER:** "Deploying is a guided flow. DevStation encodes your constructor
  arguments, compiles in the browser, and ships through your wallet, then
  records it onchain."

### 0:52–1:08 — Contract Editor (`/launchkit/editor`)
- **ON SCREEN:** Open the Editor. Type in the Monaco editor, run a compile, show
  the terminal output, then type `help` in the terminal.
- **VOICEOVER:** "Prefer to write it yourself? The Contract Editor is a full
  Solidity IDE in your browser. Pick any solc version, compile instantly, run
  static analysis, and drive an interactive terminal with commands. No backend,
  no setup."

### 1:08–1:32 — Code with AI (`/launchkit/ai`) — hero feature, give it room
- **ON SCREEN:** Open Code with AI. In Chat, show a generated contract with the
  "editor" button. Switch to the Agent tab. Type "Create an ERC-20 with
  1,000,000,000 supply and deploy it." Show the steps (generating, compiling,
  deployed) and the constructor form appearing.
- **VOICEOVER:** "This is Code with AI. In chat mode, it writes secure,
  production-grade contracts and audits the ones you paste. But switch to Agent
  mode, and it goes autonomous. Describe what you want, and it generates the
  contract, compiles it, fixes its own errors, then deploys with your wallet.
  When a constructor needs values, you get a form to review before you sign.
  From a sentence to a live contract, without leaving the page."

### 1:32–1:42 — My Projects (`/launchkit/projects`)
- **ON SCREEN:** Open Projects. Show the deployed contract list scoped to the
  wallet.
- **VOICEOVER:** "Everything you deploy lands in My Projects, your personal
  onchain deployment history, read from the registry."

### 1:42–2:04 — Inspect + Labels (`/routebook`, `/routebook/labels`)
- **ON SCREEN:** Open Routebook. Click a demo transaction. Show the decoded route
  graph, token movements, decoded method and arguments. Then open the Label
  Registry.
- **VOICEOVER:** "Routebook is more than an explorer. Paste any transaction and
  it decodes the full execution map. Named contracts, decoded methods and
  arguments, token movements, and approval risks. Those names come from the
  Label Registry, human-readable contract labels, stored onchain for everyone."

### 2:04–2:30 — QIE Explorer (`/explorer/testnet`)
- **ON SCREEN:** Open the Explorer dashboard. Show price, gas, live feeds. Click
  a transaction, then an address, then a token page with holders.
- **VOICEOVER:** "DevStation also ships a native QIE block explorer. Live price,
  gas, and network stats, with full transaction, block, address, and token
  pages. Holders, transfers, supply, all of it. Testnet and Mainnet, clearly
  labeled, reading the live chain."

### 2:30–2:40 — Activity (`/activity`)
- **ON SCREEN:** Open Activity. Show the ecosystem-wide deployment feed.
- **VOICEOVER:** "Activity shows every contract deployed through DevStation
  across the ecosystem, recorded onchain in the Project Registry."

### 2:40–2:52 — Docs, Wallet, Settings (`/docs`, wallet panel, `/settings`)
- **ON SCREEN:** Open Docs index briefly. Open the wallet panel. Open Settings.
- **VOICEOVER:** "It is all documented in a built-in guide. Connect an injected
  wallet or generate an encrypted in-app one, and tune your AI provider and
  network in Settings."

### 2:52–3:00 — Close (`/`)
- **ON SCREEN:** Return to the landing page. End card with logo and URL.
- **VOICEOVER:** "DevStation. Build, deploy, and understand contracts on QIE. Try
  it now at devstation dot online."

---

## TTS-Ready Narration (spoken lines only)

Paste each block into your TTS tool separately. Spellings are tuned for natural
pronunciation.

1. This is DevStation. The complete developer console for the QIE blockchain.
   Write, deploy, debug, and inspect contracts, all in one place, all onchain.
   Let me show you around.
2. The Overview is your home base. Live ecosystem stats, total deployments,
   unique builders, and network activity, all read straight from the chain.
3. LaunchKit Templates are audited and ready to ship. E-R-C twenty, N-F-T,
   MultiSig, Timelock, Staking, and more. Every template shows its real onchain
   deploy count, with full source and A-B-I before you commit.
4. Deploying is a guided flow. DevStation encodes your constructor arguments,
   compiles in the browser, and ships through your wallet, then records it
   onchain.
5. Prefer to write it yourself? The Contract Editor is a full Solidity I-D-E in
   your browser. Pick any solc version, compile instantly, run static analysis,
   and drive an interactive terminal with commands. No backend, no setup.
6. This is Code with A-I. In chat mode, it writes secure, production-grade
   contracts and audits the ones you paste. But switch to Agent mode, and it
   goes autonomous. Describe what you want, and it generates the contract,
   compiles it, fixes its own errors, then deploys with your wallet. When a
   constructor needs values, you get a form to review before you sign. From a
   sentence to a live contract, without leaving the page.
7. Everything you deploy lands in My Projects, your personal onchain deployment
   history, read from the registry.
8. Routebook is more than an explorer. Paste any transaction and it decodes the
   full execution map. Named contracts, decoded methods and arguments, token
   movements, and approval risks. Those names come from the Label Registry,
   human-readable contract labels, stored onchain for everyone.
9. DevStation also ships a native QIE block explorer. Live price, gas, and
   network stats, with full transaction, block, address, and token pages.
   Holders, transfers, supply, all of it. Testnet and Mainnet, clearly labeled,
   reading the live chain.
10. Activity shows every contract deployed through DevStation across the
    ecosystem, recorded onchain in the Project Registry.
11. It is all documented in a built-in guide. Connect an injected wallet or
    generate an encrypted in-app one, and tune your A-I provider and network in
    Settings.
12. DevStation. Build, deploy, and understand contracts on QIE. Try it now at
    devstation dot online.
