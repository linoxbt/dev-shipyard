# Security review: <Project name>

| | |
| --- | --- |
| Commit | `<git commit or file hash>` |
| Date | <YYYY-MM-DD> |
| Reviewer | <name or "DevStation agent"> |
| Chain | <QIE Mainnet (1990) / QIE Testnet (1983) / other> |
| Compiler | <solc version, evmVersion, optimizer runs> |

## Scope

| File | Lines | Notes |
| --- | --- | --- |
| `src/Contract.sol` | <n> | |

Out of scope: <dependencies, off-chain code, deployment scripts, anything else>.

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 0 |

<Two or three sentences: the overall state of the code, and what to fix first.>

This review looked for vulnerabilities in the code in scope at the commit above. It is not a guarantee that no issues remain.

## System overview

<Roles, value flows, external dependencies, and the invariants the review checked.>

## Findings

### [C-01] <Short title>

- **Severity:** Critical
- **Location:** `src/Contract.sol:123`
- **Status:** Open

**Description.** <What is wrong, in plain terms.>

**Impact.** <Who loses what, under which conditions.>

**Proof of concept.** `test/audit/C01.t.sol::test_<name>`, fails as expected:

```
<forge test output>
```

**Recommendation.**

```diff
- <vulnerable line>
+ <fixed line>
```

<!-- Repeat for each finding: H-01, M-01, L-01, I-01 … -->

## Test results

```
<forge test summary>
```

<Coverage notes, and any functions without tests.>
