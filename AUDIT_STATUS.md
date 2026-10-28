# Audit status

Where the October 2026 audit of DevStation stands: what was found, what was
fixed, how it was checked, and what is still open. There were two rounds:

- **Round 1:** commits `2696303` to `ec49b25` on top of `47b934f`. Every
  Critical and High finding was fixed.
- **Round 2:** from `ec49b25` to the head of `claude/sweet-volta-z02kfy`. This
  round closed what round 1 left open: contracts v2, signed releases, the
  auto-label relay, shared rate limits, host-shell git, the AI prompt
  registry, CI coverage and readiness checks. It also fixed everything an
  independent review then found in that work.

## How it was checked

- **Static checks:**
  - `bunx tsc --noEmit`, `bunx tsc -p tsconfig.cli.json` and `bun run lint` report no errors (5 fast-refresh warnings).
  - `bun audit --audit-level=high` is clean, apart from one advisory with no fix (below).
  - `actionlint` passes on every workflow.
- **Tests:** all pass with 0 failures.
  - About 1480 app tests.
  - The runner's tests.
  - 31 contract tests in an in-memory EVM, covering v1 and v2, a real ERC-20 and a fee-on-transfer token.
  - The contract artifacts and ABIs match a fresh compile for all six contracts.
- **In CI:** every push runs these jobs; see `.github/workflows/ci.yml`.

  | Job       | What it does                                                                                                                                                                                                                                     |
  | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `build`   | Types, lint, unit tests, contract drift and behaviour, dependency audit, CLI bundle, production build.                                                                                                                                           |
  | `e2e`     | Playwright in Chromium: pages at desktop and phone widths, the cross-site guard, OpenZeppelin compiling in the browser against pinned hashes.                                                                                                    |
  | `sandbox` | Builds both container images and runs the sandbox and runner suites against real containers, including the read-only `.git` mount. It fails if any test skips: a skip there used to read as a pass while the isolation it guards went unchecked. |
  | `secrets` | gitleaks over the full history.                                                                                                                                                                                                                  |

  CodeQL runs separately.

- **Independent review:** after each round. Every Critical and High finding is fixed. Each has a regression test that first shows the problem with plain git or the old code.

## Fixed in round 1 (Critical and High)

| Finding                                                                              | Fix                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host code execution through `.git/config` (fsmonitor, filters, hooks, gpg, worktree) | Control paths refused for writes; every host git command through `runGit` with fixed overrides, per-driver blanking, a pinned `GIT_DIR`, and refusal when config can't be read. |
| `/api/apps-deploy` overwriting any Netlify site                                      | HMAC `siteToken` for existing sites; ids validated.                                                                                                                             |
| Previews and the in-app wallet signing without asking                                | `confirmSign` on every signing method and network switch; permits from a preview refused.                                                                                       |
| MCP servers starting from repository config                                          | Trust pinned to the config's sha256; allow-listed environment.                                                                                                                  |
| `/api/ai` open to anyone on the operator's key                                       | Wallet grant, size caps, model allow-list, per-wallet limits.                                                                                                                   |
| Gas sponsor usable as a faucet                                                       | Gas and top-up caps, grant required, serialised sends, fail-closed budget.                                                                                                      |
| Command classifier, secret exfiltration, web-tool SSRF                               | Wrapped commands classified by what they wrap; redaction and credential-file refusal; pinned connection address and full IPv6 range list.                                       |
| Reverted transactions shown as success, wrong-chain writes, stale explorer data      | Receipts checked on the named chain; status from verification; pages keyed by hash.                                                                                             |
| Vulnerable dependencies; solc and OpenZeppelin from CDNs unchecked                   | Patched versions and overrides; pinned hashes; Monaco bundled.                                                                                                                  |

## Fixed in round 2

These were round 1's open items, plus the independent review of this round's own work.

| Item                                                                                         | Now                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace design limits (pricing, content swap, moderation, price caps, roles, fee tokens) | `DevStationMarketplaceV2`: `buyAt`, `recordDeployAt` and `featureAt` take a maximum; the content hash paid for is recorded (and follows each paid deploy); hiding never revokes paid access; creator deploys aren't counted; two-step owner and treasury moves with cancel; fee-on-transfer refused. The app detects v2 by `version()`. |
| Labels first-come and unremovable                                                            | `ContractLabelRegistryV2`: owner `removeLabel`, length caps, two-step owner.                                                                                                                                                                                                                                                            |
| Auto-labels reverting                                                                        | Server relay (`/api/label-relay`) holding the autoLabeler key. The chain's RPC must show that the signed-in wallet created the contract directly, in the last 24 hours. It never writes over another wallet's label and refuses reserved names. Sends are serialised, spend is capped per wallet and globally, and errors are generic.  |
| Unsigned CLI releases                                                                        | `release.yml` builds without write access or OIDC. A separate publish job in a `release` environment signs `SHA256SUMS` with Sigstore and attests provenance; its actions are pinned by SHA. `install.sh` and `devstation upgrade` verify against the exact tag.                                                                        |
| Host-shell `git` without overrides                                                           | `shellGitEnv` adds the overrides via `GIT_CONFIG_*` to every host shell command, covering nested repositories. `env -i` / `env GIT_*=` ask first. Alternates and `commondir` are refused.                                                                                                                                               |
| `/api/ai` takes the system prompt from the client                                            | Server-side prompt registry: only DevStation's own prompts, rebuilt from a schema-validated context, are forwarded.                                                                                                                                                                                                                     |
| Rate limits and nonces per instance                                                          | Upstash, or the runner's `/limits/hit` store (circuit-broken for 30s after a failure), then memory. Single-use nonces use the same stores.                                                                                                                                                                                              |
| Client IP on other hosts                                                                     | `TRUSTED_IP_HEADER`, documented with the other settings in `DEPLOYMENT.md`.                                                                                                                                                                                                                                                             |
| No readiness signal                                                                          | `/api/health`: 503 when a required setting is missing. Details only with `HEALTH_TOKEN`.                                                                                                                                                                                                                                                |
| Sandbox and browser paths never run in CI                                                    | The `sandbox` and `e2e` jobs, with a no-skip gate.                                                                                                                                                                                                                                                                                      |
| New advisories (Zod, DOMPurify)                                                              | Zod 4.6.7 and DOMPurify 3.4.17, with overrides.                                                                                                                                                                                                                                                                                         |

## Open

**Operator steps.** These can't be done from the repository:

1. **Deploy the v2 contracts** per [`docs/CONTRACTS_V2_RUNBOOK.md`](docs/CONTRACTS_V2_RUNBOOK.md):
   - a multisig as owner and treasury, ideally behind a timelock;
   - accept ownership;
   - point the `VITE_*` addresses at v2.
2. **Set the production environment:**
   - `SESSION_SECRET`;
   - `RUNNER_URL` and `RUNNER_TOKEN` (or Upstash);
   - `AUTOLABELER_PRIVATE_KEY`, for a key funded only for gas;
   - `TRUSTED_IP_HEADER` off Netlify and Vercel;
   - `HEALTH_TOKEN`.
     Then check `/api/health`.
3. **Protect `v*` tags** and add reviewers to the `release` environment, then push the first tag to publish the first signed release.

**Accepted:**

- **`braces` <=3.0.3 (GHSA-vfj7-8cjw-p6xm).** No patched release exists. Only build-time watchers reach it, over this repo's own globs, and CI ignores it with that note.
- **Template ids in ProjectRegistry are self-reported.** Unchanged in v2; the UI does not treat them as proof.
- **Per-deploy listings:** download access after the first payment is not metered on-chain. Deploys through DevStation pay each time.
- **The runner trusts `x-devstation-owner` from any holder of `RUNNER_TOKEN`.** This is documented, and the token must be at least 32 characters.
- **gVisor:** CI runs the container tests under runc. The gVisor kernel itself is reported by the production runner's `/health`.
