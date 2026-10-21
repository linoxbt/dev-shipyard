# Audit status

Where the October 2026 audit of DevStation stands: what was found, what was
fixed, how it was checked, and what is still open. The fixes are the commits
from `2696303` to `ec49b25` on top of `47b934f`.

## How it was checked

- **Static checks:** `bunx tsc --noEmit` and `bunx tsc -p tsconfig.cli.json` report no errors. `bun run lint` reports no errors (5 fast-refresh warnings). `bun audit --audit-level=high` reports nothing, apart from one advisory that has no fix (see below).
- **Tests:** 1437 app tests, 133 runner tests and 13 contract tests (in-memory EVM) pass with 0 failures. The contract artifacts and ABIs match a fresh compile.
- **Build:** `bun run build` succeeds (Netlify preset).
- **In a browser:** Chromium against the dev server.
  - 12 page loads at 1280px and 390px: no console errors and no horizontal overflow.
  - A same-origin POST reaches its route; it is not refused as cross-site.
  - The service worker registers with the build id.
  - A contract importing OpenZeppelin compiles in the browser. Both the solc build and every imported file pass their pinned sha256 checks.
- **Independent review:** three rounds after the fixes. Every Critical and High finding they raised is fixed and has a regression test that first shows the problem still happens with plain git or the old code.
- **Not run here:** the Docker sandbox tests, because this environment has no Docker daemon. They skip without Docker. CI's `sandbox` job builds the image and runs them, including the read-only `.git` mount.

## Critical and High: all fixed

| Finding                                                                                                       | Fix                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host code execution through `.git/config` (fsmonitor, filters, hooks, gpg, `core.worktree`, submodule config) | `isControlPath` refuses writes to `.git`, `.mcp.json`, `.agent` and `.devstation`. Every host git command runs through `runGit`: fixed `-c` overrides, per-driver blanking, an allow-listed environment, `GIT_DIR`/`GIT_WORK_TREE` pinned, submodules ignored, and it refuses to run if the config can't be read. The sandbox mounts `.git` read-only. |
| `/api/apps-deploy` overwriting any Netlify site with the operator token                                       | An HMAC `siteToken` is required for an existing site. Ids are validated and encoded.                                                                                                                                                                                                                                                                   |
| App previews and the in-app wallet signing without asking                                                     | `confirmSign` covers every signing method and network switch, and refuses when it can't ask. Permits from a preview are refused.                                                                                                                                                                                                                       |
| MCP servers starting automatically from repository config                                                     | Trust is pinned to the config's sha256. Servers get an allow-listed environment.                                                                                                                                                                                                                                                                       |
| The git tool writing files (`--output` and similar)                                                           | Flags are allow-listed per operation, and `%G` formats are refused.                                                                                                                                                                                                                                                                                    |
| `/api/ai` open to anyone on the operator's key                                                                | Wallet grant required, size caps, model allow-list, per-wallet limits.                                                                                                                                                                                                                                                                                 |
| Rate limits spoofable and resettable                                                                          | Only the platform's own IP header is trusted, LRU eviction never drops the global keys, and Upstash can be used as a shared store.                                                                                                                                                                                                                     |
| Gas sponsor usable as a faucet                                                                                | Gas cap, a cap per top-up, grant required, sends serialised and the queue bounded, budget read fails closed.                                                                                                                                                                                                                                           |
| Command classifier passing `find -exec`, `env bash -c` and similar                                            | Dangerous flags are recognised, wrapped commands are classified by what they wrap, and a newline splits commands.                                                                                                                                                                                                                                      |
| Secret exfiltration in host mode                                                                              | Case-insensitive redaction with more token formats, credential files refused (including quote-spliced names), and fetches that look like they carry data need approval.                                                                                                                                                                                |
| Web-tool SSRF                                                                                                 | The connection is pinned to the address that was checked, the full IPv6 range list is used, and the body is capped.                                                                                                                                                                                                                                    |
| Auto-labels reverting on mainnet; wrong-chain marketplace payments                                            | Labels are sent as community labels and the receipt is checked. Every write names its chain.                                                                                                                                                                                                                                                           |
| Reverted transactions shown as success; every deployment marked "VERIFIED"                                    | Receipt status is checked on the right chain with timeouts. Status starts as `PENDING` and comes from verification.                                                                                                                                                                                                                                    |
| Explorer switching the wallet's network; stale data shown after navigation; unverified labels shown as titles | The explorer reads only the chain in the URL and pages are keyed by hash. Community labels are badged as unverified.                                                                                                                                                                                                                                   |
| Editor workspace overwritten; records lost when storage is full                                               | The store loads saved state before any write. Saves are read back and checked.                                                                                                                                                                                                                                                                         |
| Vulnerable dependencies (TanStack Start XSS, seroval, shell-quote and others)                                 | Upgraded to the patched 1.168 line, plus overrides.                                                                                                                                                                                                                                                                                                    |
| Supply chain: solc, OpenZeppelin and Monaco loaded from CDNs without checks                                   | solc and OpenZeppelin hashes are pinned in the repo. Monaco is bundled.                                                                                                                                                                                                                                                                                |
| Large integers in array and tuple ABI arguments silently rounded                                              | Numbers are parsed exactly.                                                                                                                                                                                                                                                                                                                            |
| Workspace pull requests proposing to delete files the workspace never holds                                   | Deletions are filtered (and for the CLI and repo agent, only files truly gone from disk count).                                                                                                                                                                                                                                                        |

## Open: needs a contract redeploy or an operator

These can't be fixed in this repository without new contracts, keys or
infrastructure. Each is specified in [`contracts/V2_CHANGES.md`](contracts/V2_CHANGES.md):

1. **Per-deploy pricing is enforced by convention only.** The first payment grants access permanently. The docs now say so.
2. **A creator can change a listing's content after a sale.** The runner keeps the last 5 versions and a buyer can fetch one by hash; recording the hash at purchase needs v2.
3. **Moderation also removes access for past buyers.**
4. **No `maxPrice` argument.** The UI re-reads the price and refuses if it changed.
5. **Creators can inflate their own deploy counts.**
6. **One EOA holds every role, and the treasury can't be changed.** Move to a multisig plus a timelock.
7. **Fee-on-transfer tokens** would make the marketplace insolvent. QUSDC is not one today.
8. **Labels are first-come, and the owner can't reject or remove them.** The UI marks unverified labels.
9. **Auto-labels from the DevStation labeler** need a server relay that holds the labeler key.
10. **Template ids are self-reported** in ProjectRegistry.

Release process:

- **CLI releases are unsigned.** Integrity is checked against `SHA256SUMS` from the same release. Sign releases with minisign or Sigstore. Overriding the download source now prints a loud warning.
- **GitHub Actions are pinned by tag.** Dependabot keeps them current; pin them by SHA when that's convenient.

## Open: Medium and Low, accepted or follow-ups

- **`braces` <=3.0.3 (GHSA-vfj7-8cjw-p6xm).** No patched release exists. It is reached only by build-time file watchers and globs over this repo's own config, and is ignored in CI with that note.
- **Plain `git status`/`log`/`diff` run through `run_shell` in host mode** (`--no-sandbox`) are classed read-only and run without the `runGit` overrides. The agent's own git tool and checkpoints are hardened. In sandbox mode, the default, they run in the container. Follow-up: route shell git through `safeGit`, or ask first.
- **`/api/ai` still takes the system prompt from the client.** It is size-capped and behind the wallet grant. A server-side prompt registry would remove this.
- **Rate limits and single-use nonces are per instance** unless Upstash is configured. Set `UPSTASH_REDIS_REST_*` on serverless hosts.
- **On hosts other than Netlify or Vercel**, set `TRUSTED_IP_HEADER`, otherwise per-IP limits fall back to the rightmost `X-Forwarded-For` entry.
- **`objects/info/alternates` and `commondir` in a workspace** could let host git read another repository's objects. The read-only `.git` mount stops the sandbox from creating them.
- **The runner trusts `x-devstation-owner` from any holder of `RUNNER_TOKEN`.** This is documented in `services/runner/ARCHITECTURE.md`, and the runner requires the token to be at least 32 characters.
- **Blank `diff.external`.** A future host diff that omits `--no-ext-diff` fails loudly instead of running anything.
