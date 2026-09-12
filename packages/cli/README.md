# devstation

The DevStation coding agent, in your terminal. It reads a project, edits it,
runs the tests, and shows you the diff before anything leaves your machine.

## Install

The binary carries its own runtime, so it needs nothing installed first:

```sh
curl -fsSL https://devstation.online/install.sh | sh
```

Or through npm, which needs [Bun](https://bun.sh) on the machine:

```sh
npm install -g @devstation/cli
```

> **Not published yet.** `@devstation/cli` is the name this will take on npm;
> nothing is on the registry under it today, so the command above returns a 404.
> Use the installer or the release binaries until it is published. (Plain
> `devstation` on npm is an unrelated package — a dashboard for managing dev
> servers — so `npm i -g devstation` installs that, not this.)

Either way, check the install:

```sh
devstation doctor
```

## A key

The agent needs a model. Set one of these and `doctor` will go green:

```sh
export ANTHROPIC_API_KEY=...     # preferred: prompt caching, native tool use
export OPENROUTER_API_KEY=...    # also works
```

Put it in your shell profile so it survives a new terminal.

## Use it

```sh
cd your-project
devstation
```

That starts a session: say what you want, and the transcript carries across
turns, so the second thing you ask can be about the first.

For one job and out:

```sh
devstation run "fix the failing test in src/total.test.js, change the source not the test"
```

For a repository on GitHub, ending in a pull request you approve:

```sh
export GITHUB_TOKEN=$(gh auth token)
devstation repo owner/name "add a Usage section to the README"
```

## What it will not do on its own

Editing files, reading, searching and running the tests happen without asking.
Anything that deletes, installs, runs an arbitrary command, or reaches outside
the project asks first, and a plain Enter means no.

Pushing and opening a pull request it cannot do at all. It proposes; you
decide, with the diff in front of you.

## Everything else

```
devstation                      start a session and talk to it
devstation run <goal>           do one thing and stop
devstation repo <owner/name> <goal>
                                work on a GitHub repository
devstation resume [id] [note]   carry on from a stopped or crashed run
devstation status [id] [-f]     watch a run, from another terminal if you like
devstation sessions             runs in this workspace
devstation undo                 rewind the last checkpoint it made
devstation checkpoints          what it can rewind to
devstation diff                 everything it has changed
devstation index                index this project so it can search it
devstation memory               what it has been told about this project
devstation tools                its tools, and which ask first
devstation config               the settings a run would use
devstation doctor               check this machine
```

Inside a session, `/help` lists the same things as slash commands.

**[The full reference](../../docs/CLI.md)** covers every flag, the sandbox, MCP
servers, troubleshooting, and how to uninstall.

## Notes

Runs are checkpointed to git as they go, which is what `undo` rewinds. Sessions
are written to `.agent/` in the workspace after every message, so a crash is
resumable and a second terminal can follow a run with `devstation status -f`.

`.agent/` ignores itself, so none of it reaches your history.
