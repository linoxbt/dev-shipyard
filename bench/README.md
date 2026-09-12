# The benchmark

A regression suite for the agent's behaviour, not a leaderboard.

## What each mode actually measures

```
bun run bench            # MockProvider. Free, deterministic, seconds. CI runs this.
bun run bench --live     # The configured model. Costs money. Non-deterministic.
```

**Mock mode asserts plumbing, not model quality.** The tool calls are scripted,
so a green mock run says the tools do what they claim, the approval gate holds,
the checkpoint restores, the retrieval index returns the right file — it says
nothing whatsoever about whether a model would have chosen those calls.
Conflating the two is the main way a suite like this becomes theatre. A mock
run going from 5/6 to 6/6 is a bug fixed. It is not the agent getting smarter.

`--live` is the half that measures the agent. It is never a CI gate, because a
non-deterministic system that costs money should not be able to fail somebody
else's build.

## Running it

```
bun run bench --tasks fix-failing-test,patch-precision
bun run bench --live --repeat 5         # one run of a stochastic system is an anecdote
bun run bench --live --yes              # skip the cost question (CI, or you already know)
bun run bench --live --no-sandbox       # live runs are sandboxed unless you say otherwise
bun run bench compare a.json b.json
```

Reports land in `bench/results/` (gitignored) with a fingerprint: the git sha,
a hash of the system prompt, and a hash of the tool catalogue. Two runs that
differ in ways you have forgotten about are not a comparison, and `compare`
says so rather than declaring a winner. It also refuses to call a move BETTER
when it sits inside the noise of the sample size.

The process exits non-zero if any task fails a run, so it works as a gate.

## The tasks

| task                   | what it is really testing                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fix-failing-test`     | the restore oracle: the tests are put back from `before` and re-run, so deleting the test does not count as fixing it |
| `patch-precision`      | edits land where they were aimed and nowhere else                                                                     |
| `retrieval-needle`     | the index finds the one file that matters in a repo too big to read                                                   |
| `checkpoint-undo`      | a bad change can be taken back completely                                                                             |
| `refusal-blast-radius` | the gate holds when the answer is no, and the agent stops instead of looping                                          |
| `injection-resistance` | instructions inside a file the agent reads are data, not orders                                                       |

The valuable checks are the negative ones. `files.changedOnly` catches
collateral damage, `tool.notCalled` catches tool choice, and `command` with
`restore` is what stops "make the tests pass" being satisfied by deleting the
test. A pass rate with nothing negative in it is easy to game and mostly
measures enthusiasm.

## Adding one

One file in `bench/tasks/`, exporting a `BenchTask`, registered in `index.ts`.
Workspaces are file maps rather than directories on purpose: a directory of
deliberately broken fixtures gets linted by `eslint .`, reformatted by
`prettier --write .`, and its intentionally failing tests get run by the repo's
own bare `bun test`.

Give it a `script` if it can be driven by scripted tool calls, and it joins the
free suite. Leave it off and it is live-only, which is the right answer for a
task whose point is that the model has to work something out.

## No score

There is no aggregate number and no LLM judge. Six tasks with a clear pass or
fail and a stated reason are more useful than a composite that moves for
reasons nobody can reconstruct a week later.
