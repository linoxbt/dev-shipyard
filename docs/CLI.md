# The DevStation CLI

The coding agent in a terminal. It reads a project, edits it, runs the tests,
and shows you what changed. Everything happens on your machine; nothing leaves
it except the model calls.

This is the reference. `packages/cli/README.md` is the two-minute version.

- [Installing](#installing)
- [A model key](#a-model-key)
- [Using it](#using-it)
- [Every command](#every-command)
- [Every flag](#every-flag)
- [What it asks permission for](#what-it-asks-permission-for)
- [The sandbox](#the-sandbox)
- [Undo](#undo)
- [Memory and search](#memory-and-search)
- [MCP servers](#mcp-servers)
- [Debugging](#debugging)
- [Environment variables](#environment-variables)
- [What it writes to disk](#what-it-writes-to-disk)
- [Uninstalling](#uninstalling)

## Installing

The binary carries its own runtime, so nothing needs to be installed first.

```sh
curl -fsSL https://devstation.online/install.sh | sh
```

It downloads the binary for your platform, **checks it against the published
`SHA256SUMS`**, and installs nothing if that does not match. Then it goes to
`~/.devstation/bin/devstation`, and the installer tells you if that directory
is not on your `PATH`.

Pick a specific version, or install somewhere else:

```sh
DEVSTATION_VERSION=v0.1.0 curl -fsSL https://devstation.online/install.sh | sh
DEVSTATION_INSTALL_DIR=/usr/local/bin curl -fsSL https://devstation.online/install.sh | sh
```

### By hand

Every release carries five binaries and their checksums:

```sh
cd /tmp
curl -fLO https://github.com/linoxbt/dev-shipyard/releases/latest/download/devstation-linux-x64
curl -fLO https://github.com/linoxbt/dev-shipyard/releases/latest/download/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
install -m755 devstation-linux-x64 ~/.devstation/bin/devstation
```

`devstation-linux-x64`, `devstation-linux-arm64`, `devstation-darwin-arm64`,
`devstation-darwin-x64`, `devstation-windows-x64.exe`.

### Through npm

Needs [Bun](https://bun.sh) on the machine, because this route ships the
JavaScript rather than a self-contained binary:

```sh
npm install -g @devstation/cli
```

> **Not published yet.** `@devstation/cli` is the name this will take on npm;
> nothing is on the registry under it today, so the command above returns a 404.
> Use the installer or the release binaries until it is published. (Plain
> `devstation` on npm is an unrelated package — a dashboard for managing dev
> servers — so `npm i -g devstation` installs that, not this.)
>
> If you have already run `npm i -g devstation` and got that dashboard, the
> symptom is `devstation config` printing a box about `http://localhost:4000`.
> Undo it with `npm uninstall -g devstation`, then `hash -r` so your shell
> forgets the old path.

### Check the install

```sh
devstation doctor
```

## A model key

The agent needs a model. Set one and `doctor` goes green:

```sh
export ANTHROPIC_API_KEY=...     # preferred: prompt caching and native tool use
export OPENROUTER_API_KEY=...    # also works, and reaches other vendors
```

Put it in your shell profile so a new terminal keeps it. Nothing is stored by
the CLI itself: it reads the environment each run.

## Using it

```sh
cd your-project
devstation
```

That starts a session. Say what you want; the transcript carries across turns,
so the second thing you ask can be about the first.

One job and out:

```sh
devstation run "fix the failing test in src/total.test.js, change the source not the test"
```

Work on a GitHub repository and finish with a pull request you approve:

```sh
export GITHUB_TOKEN=$(gh auth token)
devstation repo owner/name "add a Usage section to the README"
```

Watch a run from another terminal, or pick one up after a crash:

```sh
devstation status -f
devstation resume            # the last run in this workspace
devstation resume <id> "actually, use the existing helper"
```

## Every command

```
devstation                      start a session and talk to it
devstation run <goal>           do one thing and stop
devstation repo <owner/name> <goal>
                                work on a GitHub repository, propose a pull request
devstation resume [id] [note]   carry on from a stopped or crashed run
devstation status [id] [-f]     show what a run is doing (-f to follow)
devstation sessions             list runs in this workspace
devstation undo                 rewind the last agent checkpoint
devstation checkpoints          list the checkpoints it can rewind to
devstation diff                 show what the agent has changed
devstation index                index this project so the agent can search it
devstation memory               show what it has been told about this project
devstation mcp                  the MCP servers configured here, and their tools
devstation tools                list the tools it can use, and which ones ask first
devstation config               show the settings this run would use
devstation doctor               check this machine is set up to run it
devstation version              print the version
devstation help                 the summary
```

Inside a session, the same things are slash commands: `/undo` `/status`
`/sessions` `/checkpoints` `/diff` `/tools` `/memory` `/mcp` `/cost` `/config`
`/clear` `/help` `/exit`. **Ctrl-C** interrupts the turn in progress without
leaving; **Ctrl-D** leaves.

`/cost` is session-only: it reports what has been spent so far.

## Every flag

```
-C, --root <dir>     work somewhere other than the current directory
    --model <name>   override the model for this run
    --autonomy <m>   ask_sensitive | ask_integrations | ask_deploy | autonomous
    --max-steps <n>  stop after n tool calls
    --budget <usd>   stop before a turn that would exceed this
-y, --yes            approve every gated action without asking
-f, --follow         keep watching (status only)
    --json           machine-readable output where it makes sense
    --no-sandbox     run commands on this machine instead of in a container
-h, --help
-v, --version
```

`--json` is honoured by the four commands that report rather than act:
`config`, `sessions`, `checkpoints` and `tools`. Use it from a script; the
human output is not a stable shape.

## What it asks permission for

Reading, searching, editing files and running the tests happen without asking.
That is the point: a tool that interrupts you for ordinary work gets its
prompts clicked through without being read, which is worse than not asking.

It asks before anything that loses data, spends money, changes who can get in,
or reaches production. A plain Enter means no.

`--autonomy` moves the line, and there is a floor it cannot move:

| mode                      | what proceeds unattended                        |
| ------------------------- | ----------------------------------------------- |
| `ask_sensitive` (default) | ordinary development only                       |
| `ask_integrations`        | the same, plus integration-shaped work          |
| `ask_deploy`              | everything except deploys and anything critical |
| `autonomous`              | everything except **critical**                  |

**Critical always asks, whatever the setting.** That is deleting a project,
reading stored credentials, running an arbitrary shell command, and rewinding
git history. `-y` approves gated actions for that run; it does not lower the
floor either.

Two things it cannot do at all: push, and open a pull request. It proposes; you
decide, with the diff in front of you.

`devstation tools` prints the whole catalogue and which side of the line each
tool falls on, for the settings you would actually run with.

## The sandbox

Shell commands run inside a container, not on your machine. On by default.

- The workspace is mounted and writable. **Everything else on the machine is
  not reachable.**
- The shell has **no network at all**. `install_dependency` is given one for
  that single command, and `fetch_url` reads pages. The agent is told this, so
  it uses those rather than fighting a sealed `curl`.
- Files it writes come out owned by you, not by root.

It needs Docker, and by default [gVisor](https://gvisor.dev) (`runsc`) as the
runtime, which puts a user-space kernel between the container and the host.
Build the image once:

```sh
bun run sandbox:image        # docker build -t devstation-sandbox:1 -f docker/sandbox.Dockerfile docker
```

If Docker, the runtime or the image is missing, the CLI **refuses to start**
and names the fix. It does not quietly run your commands unsandboxed: someone
who believes they are sandboxed and is not is worse off than someone who knows
they are not. `--no-sandbox` is the deliberate way to accept that, and
`DEVSTATION_SANDBOX=off` is the environment equivalent.

Weaker isolation, if gVisor is not available:

```sh
DEVSTATION_SANDBOX_RUNTIME=runc devstation
```

That still gives a separate filesystem and no network. It does not give you a
kernel boundary.

The banner's third line always says which you got, in as many words.

## Undo

The agent checkpoints after any turn that changed a file, so there is always a
way back.

```sh
devstation checkpoints    # what it can rewind to
devstation undo           # rewind one turn
devstation diff           # everything it has changed since the run started
```

**In a git repository** a checkpoint is a real commit, subject-prefixed
`agent checkpoint:`. `undo` is `git reset --hard` back one of them, and it only
ever rewinds commits the agent made — a commit of yours sitting on top is never
discarded. Uninstalling does not remove them; `git log --oneline --grep='^agent
checkpoint:'` finds them.

**Without git** it is a file snapshot under `.devstation/checkpoints/`, taken
before the turn's changes land. `undo` restores the files and removes anything
the turn added, which is what makes it an undo rather than a merge. Twenty are
kept.

`diff` needs git, because a snapshot holds no base to compare against the way a
commit does. It says so and points at `checkpoints`.

## Memory and search

```sh
devstation index      # build the index for this project
devstation memory     # what it has been told
```

`index` walks the project and builds a BM25 index at `.agent/memory.db`, so the
agent can find the one file that matters in a repository too big to read. First
run pays for the walk; after that it re-chunks only what changed.

Memory is different from the index: the index knows what the code says, memory
holds what it cannot derive — that deploys go out on Fridays, that a previous
session tried the obvious fix and it did not work. The agent appends to it
through a tool; it is never rewritten, entries are dated, and you can read or
delete it by hand.

It lives in `.agent/PROJECT_MEMORY.md`. **Put a `PROJECT_MEMORY.md` at your
project root and that wins instead** — its presence is you saying you want
these notes checked in and shared. The agent will not create a file in your
repository to hold its own notes; that is your decision to make.

## MCP servers

Tools from [MCP](https://modelcontextprotocol.io) servers are offered to the
agent alongside the built-in ones, namespaced `server__tool` so two servers
cannot shadow each other or a built-in.

`.devstation/mcp.json` in the project, then `~/.devstation/mcp.json`. The
nearer file wins, so a project has the last word about its own servers.

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./app.db"],
      "env": { "LOG_LEVEL": "warn" },
      "disabled": false
    }
  }
}
```

`disabled: true` skips one without removing it. `devstation mcp` lists what is
configured and every tool each server actually offers, which is the quickest
way to see whether a server is starting at all.

## Debugging

**Start here.** `doctor` checks each thing a run needs and names the fix for
whatever is missing:

```sh
devstation doctor
```

```
no  model provider   set ANTHROPIC_API_KEY, or OPENROUTER_API_KEY
ok  git              git version 2.43.0
ok  workspace        /home/you/project (a git repository)
ok  write access     the agent can edit files here
ok  runtime          bun 1.3.14
ok  docker           reachable
ok  isolation        runsc, a user-space kernel between commands and this host
ok  sandbox image    devstation-sandbox:1, running as 1000:1000 (your uid)
```

| symptom                                                      | what it is                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devstation config` prints a box about `localhost:4000`      | a different package of the same name is first on your `PATH`. `command -v devstation` will show `/usr/local/bin/devstation`. Remove it: `npm uninstall -g devstation` |
| `command not found` after installing                         | `~/.devstation/bin` is not on your `PATH`. The installer prints the line to add                                                                                       |
| `bash: /usr/local/bin/devstation: No such file or directory` | your shell cached the path of a `devstation` that has since been removed. `hash -r`, or open a new terminal                                                           |
| refuses to start, naming Docker or the image                 | the sandbox is unavailable. Build it with `bun run sandbox:image`, or accept the risk with `--no-sandbox`                                                             |
| every shell command fails to reach the network               | that is the sandbox working. The agent should use `install_dependency` and `fetch_url` instead                                                                        |
| a run stops saying it reached its budget                     | `--budget` was hit. Raise it, or `--max-steps` if it is looping                                                                                                       |
| a turn says it only half happened                            | some tool calls in that turn failed after others had written. Nothing rolls back on purpose; read what it says and decide                                             |
| it will not push or open a pull request                      | it cannot, by design. `devstation diff`, then do it yourself                                                                                                          |
| a session seems stuck                                        | `devstation status -f` from another terminal shows the live steps                                                                                                     |
| it crashed mid-run                                           | `devstation resume` — sessions are written to `.agent/` after every message                                                                                           |

`config` shows exactly what a run would use, including which provider and
model it resolved and whether the sandbox is on:

```sh
devstation config
devstation config --json
```

`sessions` gives you the history of past runs, and `sessions --json` the same
thing in a shape a script can read. `status -f` follows a live one.

## Environment variables

| variable                            | what it does                                          |
| ----------------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`                 | model provider (preferred)                            |
| `OPENROUTER_API_KEY`                | model provider                                        |
| `ANTHROPIC_MODEL` / `AI_MODEL`      | override the model without a flag                     |
| `ANTHROPIC_MAX_TOKENS`              | cap the reply length                                  |
| `ANTHROPIC_EFFORT` / `AI_REASONING` | reasoning effort, for models that take one            |
| `GITHUB_TOKEN` or `GH_TOKEN`        | needed by `devstation repo`, with push rights         |
| `DEVSTATION_SANDBOX=off`            | run commands on this machine (same as `--no-sandbox`) |
| `DEVSTATION_SANDBOX_IMAGE`          | use a different sandbox image                         |
| `DEVSTATION_SANDBOX_RUNTIME`        | `runc` where gVisor is unavailable                    |
| `AGENT_INPUT_COST` etc.             | override per-million-token rates used by `--budget`   |
| `DEVSTATION_INSTALL_DIR`            | where the installer puts the binary                   |
| `DEVSTATION_VERSION`                | which release the installer fetches                   |

## What it writes to disk

Inside the workspace, and nowhere else:

```
.agent/sessions/           run records, written after every message
.agent/memory.db           the search index
.agent/PROJECT_MEMORY.md   what it has been told (unless one exists at the root)
.agent/.gitignore          ignores itself, so none of it reaches your history
.devstation/checkpoints/   snapshot undo history, when there is no git
.devstation/repos/         repositories cloned by `devstation repo`
.devstation/mcp.json       per-project MCP servers, if you add them
```

And in your home directory: `~/.devstation/bin/devstation`, plus
`~/.devstation/mcp.json` if you use global MCP servers. Nothing else, anywhere.

## Uninstalling

The binary and anything global:

```sh
rm -rf ~/.devstation
sed -i '/\.devstation\/bin/d' ~/.profile     # macOS: sed -i '' '/\.devstation\/bin/d' ~/.profile
```

Installed through npm instead: `npm uninstall -g @devstation/cli`.

Per-project state, in each project you used it in:

```sh
rm -rf .agent .devstation
```

The sandbox image, if you want the disk back:

```sh
docker rmi devstation-sandbox:1
docker ps -aq --filter name=devstation-agent- | xargs -r docker rm -f
```

Three things deliberately survive:

- **`PROJECT_MEMORY.md` at a project root** is yours. The agent only appends to
  it, and it is only there if you created it.
- **Git checkpoint commits** are real commits in your history. Run
  `devstation undo` before uninstalling if you want them rewound, or find them
  with `git log --oneline --grep='^agent checkpoint:'`.
- **Your `.gitignore`** was never edited.
