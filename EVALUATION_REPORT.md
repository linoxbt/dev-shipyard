# DevStation (dev-shipyard) — Technical Evaluation Report

**Repository:** `github.com/linoxbt/dev-shipyard`
**Reviewed commit:** `6aa663d` ("Update site info for publish"), 2026-06-05
**Reviewer:** Independent code review
**Date:** 2026-06-05

---

## 1. Executive Summary

DevStation is a **front-end-only MVP** of a "QIE Builder Console" — a developer
tool for the QIE blockchain combining two products: **LaunchKit** (a contract
template gallery + deploy wizard) and **Routebook** (a transaction-trace
decoder). It was generated with **Lovable** on the TanStack Start template and
is a polished, fully navigable UI demo.

The critical thing to understand: **nothing in this app touches a blockchain.**
Every wallet connection, deployment, transaction decode, gas estimate, and fee
is **simulated with hard-coded mock data**. This is disclosed honestly in the
build plan (`.lovable/plan.md`) and in-app ("Live RPC decoding is wired up
post-MVP"). Judged as a _UI prototype / design demo_, it is well-executed.
Judged as a _working product_, it is not yet functional.

**Overall grade as an MVP prototype: B+ / A−.**
Clean architecture, consistent design, builds and type-checks with zero errors.
The gap between "looks done" and "is done" is the entire backend.

| Dimension                | Rating | Note                                      |
| ------------------------ | ------ | ----------------------------------------- |
| Build / type safety      | ★★★★★  | `tsc --noEmit` clean, `vite build` clean  |
| UI/UX & design system    | ★★★★☆  | Cohesive, professional terminal aesthetic |
| Architecture / structure | ★★★★☆  | Clean separation, mock layer is swappable |
| Real functionality       | ★☆☆☆☆  | 100% mocked — no chain, no backend        |
| Code quality             | ★★★★☆  | Readable; lint formatting unclean         |
| Testing                  | ☆☆☆☆☆  | No tests, no CI                           |
| Production readiness     | ★★☆☆☆  | Demo-ready, not product-ready             |

---

## 2. What the App Does

### LaunchKit (contract deployment)

- **Templates gallery** (`/launchkit/templates`) — 8 seeded contract templates
  (SimpleERC20, SimpleERC721, MultiSigWallet, TokenVesting, SimpleStaking,
  TimelockController, SoulboundNFT, PaymentSplitter) with category filters,
  search, and sort.
- **Template detail** (`/launchkit/templates/$id`) — Solidity source viewer
  with custom syntax highlighting + collapsible ABI preview.
- **Deploy wizard** (`/launchkit/deploy`) — 3-step flow: select → configure
  (dynamic form generated from constructor args) → animated "terminal"
  deployment progress → success screen with `.env` download and a pre-filled
  hackathon submission blurb.
- **Projects** (`/launchkit/projects`) — table of "deployed" contracts with a
  slide-over detail panel.

### Routebook (transaction inspection)

- **Inspector home** (`/routebook`) — hash search box + two demo transactions.
- **Decoded transaction** (`/routebook/$txHash`) — recursive call-tree graph,
  token-movement panel, approval risk detector, revert decoder with
  human-readable explanations, and a gas-breakdown tab.
- **Label registry** (`/routebook/labels`) — address→name registry with
  AUTO/COMMUNITY/VERIFIED source badges and a submit modal (mock "0.5 USDQ burn"
  fee).

### Settings

Network config, oracle settings, display prefs, QIE Pass status — all local
component state, none persisted.

---

## 3. Technology Stack

| Layer           | Choice                                      | Assessment                            |
| --------------- | ------------------------------------------- | ------------------------------------- |
| Framework       | TanStack Start (RC) + TanStack Router       | Modern, file-based routing, SSR       |
| UI              | React 19, Tailwind v4, shadcn/Radix         | Current, well-supported               |
| State           | Zustand                                     | Lightweight, appropriate              |
| Data fetching   | TanStack Query (installed, **barely used**) | Provisioned for future API            |
| Validation      | Zod                                         | Used for route search params          |
| Runtime/pkg mgr | Bun                                         | Fast; lockfile committed              |
| Deploy target   | Cloudflare Workers (Nitro)                  | Indicated by `config.server.ts` notes |

**~8,800 LOC** across `src` (a large share is shadcn UI primitives — 50+
components in `src/components/ui/`, most unused by the actual pages).

---

## 4. Verified Build Health

All checks run during this review:

```
bun install        → clean
tsc --noEmit       → exit 0, ZERO type errors
vite build         → exit 0, 86 modules, built in ~2.6s
```

- **Type safety is genuinely solid.** Interfaces are well-defined
  (`DecodedTx`, `RouteCall`, `Template`, `ContractLabel`), and the strictness
  pays off — the app compiles with no `any` leaks in the domain layer.
- **Client bundle: ~712 KB** total, but **one chunk is ~494 KB** (`index-*.js`)
  — the framework/vendor bundle. Route chunks are nicely code-split
  (deploy 17 KB, routebook 14 KB). Acceptable for a dev tool; worth revisiting
  before any public launch.

---

## 5. Architecture Review

### Strengths

1. **The mock layer is deliberately swappable.** The plan states each
   integration point is "structured behind a `lib/services/*.ts` module
   returning typed mock data." In practice the mocks live in `src/lib/mock/*`
   and are consumed through typed accessors (`findDemoTx`, `getTemplate`,
   `findLabel`, `useProjects`). Replacing them with real RPC/contract calls is a
   **localized change** — the type contracts already exist. This is the single
   best architectural decision in the project.

2. **Clean route/component separation.** Pages are self-contained, shared
   primitives (`AddressChip`, `TxHashChip`, `StatusBadge`, `CodeBlock`,
   `TerminalOutput`) are reused consistently, and the recursive `RouteNode`
   component is a tidy solution for the call-tree.

3. **Honest server scaffolding.** `config.server.ts`, `server.ts`, and
   `start.ts` show real care: per-request env reads for Cloudflare Workers,
   SSR error normalization for h3's swallowed-throw behavior, and an error
   middleware. This is more thoughtful than typical generated boilerplate.

4. **Design system discipline.** Semantic Tailwind tokens only (no ad-hoc hex
   in components), a coherent terminal/amber/teal theme, consistent mono
   typography. The UI looks like a real product.

### Weaknesses & Risks

1. **No backend whatsoever — the product's core value is unbuilt.** The entire
   premise (deploy contracts, decode live transactions) requires `solc`
   compilation, `ethers`/`viem` tx submission, `debug_traceTransaction`
   decoding, and explorer verification. **None exist.** The deploy "terminal"
   is a typewriter animation over a fixed string array
   (`launchkit.deploy.tsx:296`), the deployed address is
   `"0x" + randomHex(40)` (`:80`), and `findDemoTx` only resolves **two**
   hard-coded hashes — any other hash shows "Transaction Not Found."

2. **No persistence.** Deployed "projects" live in a Zustand store seeded on
   every load; a refresh wipes anything the user did. Settings don't save.

3. **No tests, no CI.** Zero test files, no test framework, no `.github/`
   workflows. For a tool whose real version would handle deployments and
   financial transactions, this is a significant gap to carry forward.

4. **`wagmi` is referenced but absent.** `wallet.ts` says "Replace with wagmi
   later," but no web3 wallet library is installed. The wallet is a Zustand
   store hard-coded to `connected: true` with a fake address — there is no
   actual connect flow.

5. **TanStack Query is provisioned but idle.** The provider is wired in
   `__root.tsx`, yet no `useQuery` calls exist. Harmless, but signals the data
   layer was never reached.

---

## 6. Code Quality — Specific Findings

| Severity       | Location                   | Finding                                                                                                                                                                                                                         |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low (security) | `CodeBlock.tsx:55`         | Uses `dangerouslySetInnerHTML` for syntax highlighting. **Mitigated** — input is HTML-escaped first via `escapeHtml()`, and all current input is static/trusted. Safe today; revisit if user-supplied code is ever highlighted. |
| Low            | `launchkit.deploy.tsx:80`  | `randomHex` uses `Math.random()` — fine for mock UI, must not survive into anything cryptographic.                                                                                                                              |
| Low            | `launchkit.deploy.tsx:297` | Deploy terminal hard-codes `"SimpleERC20.sol"` regardless of the template actually selected — a demo seam that will read as a bug to testers.                                                                                   |
| Low            | `templates.ts`             | 5 of 8 templates have placeholder Solidity bodies (`/* ... impl ... */`) and empty ABIs (`"[]"`). Only ERC20/ERC721/MultiSig are real source.                                                                                   |
| Cosmetic       | repo-wide                  | **188 ESLint errors, all auto-fixable `prettier/prettier` formatting.** No logic errors. `bun run format` clears them. Indicates the formatter was never run before commit.                                                     |
| Cosmetic       | 6 files                    | `react-refresh/only-export-components` warnings (constants exported alongside components) — DX-only, harmless.                                                                                                                  |
| Cosmetic       | `routebook.$txHash.tsx:1`  | `notFound` imported but unused.                                                                                                                                                                                                 |

> Note: the lint **errors** sound alarming at "188 problems" but are entirely
> whitespace/line-wrapping. The actual code is clean. Running the project's own
> `format` script resolves all of them.

---

## 7. Product / UX Assessment

- The UX is **convincing and complete end-to-end** — you can click through every
  screen and it feels like a shipping product. For a hackathon demo or investor
  walkthrough, this is exactly the right deliverable.
- Thoughtful touches: revert decoder with plain-English explanations + suggested
  fixes (`transactions.ts:715` `REVERT_PATTERNS`), approval-risk flagging,
  gas-cost-in-USD via a mock oracle, "wrong network" banner, copy-to-clipboard
  everywhere.
- **Risk for the audience:** the polish is high enough that a non-technical
  viewer may not realize nothing is real. The "hackathon submission" generator
  and QIE-specific framing suggest this was built for a **QIE hackathon**, where
  that distinction matters for judging.

---

## 8. Recommendations

**To reach a functional v1 (priority order):**

1. **Wire one real path end-to-end** before broadening. Suggest Routebook
   decode: connect to `rpc1testnet.qie.digital`, pull a real tx + receipt, and
   render even a shallow trace. Proves the chain integration works.
2. **Add a real wallet.** Install `wagmi` + `viem`, implement actual
   connect/network-switch, replace the mock `useWallet` store.
3. **Build the deploy pipeline.** `solc-js` compile → `viem` deploy → poll
   receipt. Replace the typewriter animation with real status streaming.
4. **Persist state.** Move projects/settings to `localStorage` (quick win) or a
   real backend (durable). Currently everything evaporates on refresh.
5. **Introduce tests + CI.** At minimum: typecheck + lint + build on PR via
   GitHub Actions; component tests for the recursive `RouteNode` and the deploy
   wizard state machine.

**Quick hygiene wins (minutes):**

- Run `bun run format` to clear all 188 lint errors.
- Remove the unused `notFound` import.
- Fix the hard-coded `SimpleERC20.sol` string in the deploy terminal.
- Fill in or clearly mark the 5 placeholder template sources.

---

## 9. Conclusion

DevStation is a **high-quality front-end prototype** — clean architecture,
strong type safety, a cohesive design system, and an honest, well-documented
mock layer engineered for easy real-data swap-in. It builds and type-checks
flawlessly. As a demo of a vision for QIE developer tooling, it succeeds.

It is **not a working product.** The defining feature set — deploying contracts
and decoding live transactions — is entirely simulated, there is no backend, no
persistence, and no tests. The distance from here to a usable tool is large and
lives almost entirely in code that hasn't been written yet (chain integration,
compilation, real wallet, storage).

**Bottom line:** Excellent scaffolding and presentation; the hard 80% (the
on-chain engine) remains to be built. Evaluate accordingly depending on whether
the goal is "impressive demo" (delivered) or "shippable tool" (not yet).
