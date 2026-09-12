# devstation

The DevStation coding agent, in your terminal. It reads a project, edits it,
runs the tests, and shows you the diff before anything leaves your machine.

## Install

The binary carries its own runtime, so it needs nothing installed first:

```sh
curl -fsSL https://devstation.online/install.sh | sh
```

Or through npm, which needs nothing else either — it fetches the same binary
and verifies the same checksums:

```sh
npm install -g @devstationlabs/cli
```

> Plain `devstation` on npm is an **unrelated package** — a dashboard for
> managing dev servers. `npm i -g devstation` installs that, not this.

Either way, check the install:

```sh
devstation doctor
```

## Set up a model

```sh
devstation login
```

Pick a provider, paste a key (it is hidden as you type), choose a model. It is
stored in `~/.devstation/credentials.json`, readable only by you, so every new
terminal just works. Anthropic, OpenRouter, OpenAI, and any OpenAI-compatible
server — Ollama, LM Studio, Groq — are supported:

```sh
devstation login openai        # then give it http://localhost:11434/v1 for Ollama
devstation config              # what it will use, and where each value came from
```

Exporting `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` still works, and is what a
server or CI job should do.

## Upgrade

```sh
devstation upgrade
```

It upgrades however it was installed: through npm for an npm install, or by
downloading and verifying the new binary for the standalone one.

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
