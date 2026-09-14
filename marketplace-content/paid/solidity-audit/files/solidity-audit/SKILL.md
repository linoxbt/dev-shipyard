---
name: solidity-audit
description: Run a structured security review of Solidity contracts and write an audit report with severity-ranked findings, each backed by a failing proof-of-concept test.
---

# Solidity security review

Use this skill when the user asks for an audit, a security review, "is this contract safe", or a pre-deployment check. It produces a written report, not code changes. Fix nothing unless the user asks afterwards.

A review is only as good as its evidence. Every High or Critical finding needs a test that fails today and demonstrates the problem. A finding you cannot demonstrate is at most Low, and is marked "not demonstrated".

## Steps

1. **Fix the scope.**
   - List the contracts in scope, with file paths, and record the git commit (`git rev-parse HEAD`) or a hash of the files.
   - Note the Solidity version, compiler settings (`evmVersion`, optimizer) and the target chain.
   - Ask about anything that changes the threat model: who holds admin keys, whether contracts are upgradeable, which tokens they accept.
2. **Build and run what exists.**
   - `forge build && forge test`, or `npx hardhat test`. Record failing tests; they are findings in themselves.
   - Where Foundry is present, run `forge coverage` and note untested functions.
3. **Run static analysis where it is available.**
   - `slither . --exclude-dependencies` if Slither is installed (`pip install slither-analyzer` otherwise, if the user agrees).
   - Treat its output as leads, not findings: confirm each by reading the code.
4. **Map the system before hunting.** For each contract, write down:
   - its roles, and what each may call;
   - where value enters and leaves (ETH or QIE, tokens, NFTs);
   - external calls and the contracts they reach;
   - the state that must never break, the invariants: "total deposits equal the token balance", "a withdrawal cannot exceed a balance".
5. **Review against `checklist.md`,** one section at a time. For each item, look at every function it applies to. Record where you checked, not only where you found something.
6. **Prove each serious finding.** Write a Foundry test in `test/audit/` that reproduces it: an attacker contract, a sequence of calls, and an assertion that shows the loss or the broken invariant. Run it and keep the output.
7. **Rate severity.**
   - **Critical:** funds can be stolen or permanently locked, or the contract taken over, by anyone, with no special conditions.
   - **High:** loss of funds or of core function under realistic conditions, or by a privileged role acting beyond its stated powers.
   - **Medium:** loss under unlikely conditions, temporary denial of service, or a broken guarantee that users rely on.
   - **Low:** best-practice gaps with limited impact, or findings that could not be demonstrated.
   - **Informational:** clarity, gas, events, documentation.
8. **Write the report** from `report-template.md`, into `AUDIT.md` at the project root unless the user wants it elsewhere. For every finding give:
   - the location (file:line);
   - what goes wrong, and why it matters;
   - the proof (test name and result);
   - the minimal fix, as a diff when it is short.
9. **Finish with the summary.** Give the user the counts by severity, the one or two issues to fix first, and what was out of scope. Say plainly that this review does not guarantee the absence of bugs.

## Chain-specific checks for QIE

- Compiled with `evmVersion` shanghai or earlier? QIE's EVM has no MCOPY.
- Does any off-chain component rely on `eth_estimateGas` for storage writes? On QIE it underestimates; transactions can run out of gas.
- Does anything gate on QIE ID? QIE hands new wallets free, randomly named IDs, so "holds a QIE ID" is not proof of a registered identity.
- Does anything assume QUSDC has 18 decimals? It has 6.

## Done means

- `AUDIT.md` exists, follows the template, and names the commit or file hash it reviewed.
- Every Critical and High finding has a proof-of-concept test in `test/audit/` that fails today, and its output is quoted in the report.
- Every checklist section was worked through, with where you checked recorded, including sections with no findings.
- No code outside `test/audit/` was changed.
- The user has the severity counts, what to fix first, and what was out of scope.
