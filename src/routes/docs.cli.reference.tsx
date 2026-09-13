import { createFileRoute } from "@tanstack/react-router";
import { BookText } from "lucide-react";
import { DocPage, H2, H3, P, Code, C, Table } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/reference")({
  head: () => ({ meta: [{ title: "CLI Reference · DevStation CLI" }] }),
  component: CliReference,
});

function CliReference() {
  return (
    <DocPage
      title="CLI Reference"
      icon={BookText}
      intro="Every command, flag and environment variable, and every file the CLI writes."
    >
      <H2>Commands</H2>
      <Table
        head={["Command", "What it does"]}
        rows={[
          ["devstation", "Start a session and talk to it."],
          ["devstation run <goal>", "Do one thing and stop."],
          [
            "devstation repo <owner/name> <goal>",
            "Work on a GitHub repository and propose a pull request.",
          ],
          ["devstation resume [id] [note]", "Carry on from a stopped or crashed run."],
          ["devstation status [id] [-f]", "Show what a run is doing. -f follows it."],
          ["devstation sessions", "List runs in this workspace."],
          ["devstation undo", "Rewind the last agent checkpoint."],
          ["devstation checkpoints", "List the checkpoints it can rewind to."],
          ["devstation diff", "Show what the agent has changed."],
          ["devstation index", "Index this project so the agent can search it."],
          ["devstation memory", "Show what it has been told about this project."],
          ["devstation mcp", "The MCP servers configured here, and their tools."],
          ["devstation tools", "List the tools it can use, and which ones ask first."],
          ["devstation login [provider]", "Choose a provider, store its key, pick a model."],
          ["devstation logout [provider]", "Remove stored keys."],
          ["devstation config", "Show the settings a run would use. Also set, get, unset, path."],
          ["devstation upgrade [--check]", "Update to the latest version, or only check."],
          ["devstation doctor", "Check this machine is set up to run it."],
          ["devstation version", "Print the version."],
          ["devstation help", "The summary."],
        ]}
      />

      <H2>Flags</H2>
      <Table
        head={["Flag", "What it does"]}
        rows={[
          ["-C, --root <dir>", "Work somewhere other than the current directory."],
          ["--model <name>", "Override the model for this run."],
          ["--autonomy <mode>", "ask_sensitive | ask_integrations | ask_deploy | autonomous"],
          ["--max-steps <n>", "Stop after n tool calls."],
          ["--budget <usd>", "Stop before a turn that would exceed this."],
          ["-y, --yes", "Approve every gated action without asking. Critical still asks."],
          ["-f, --follow", "Keep watching (status only)."],
          ["--session <id>", "Choose the run to act on."],
          ["--json", "JSON output from config, sessions, checkpoints and tools."],
          ["--no-sandbox", "Run commands on this machine instead of in a container."],
          [
            "--project",
            "With config set or unset: write this workspace's config, not the global one.",
          ],
          ["-h, --help", "Show help."],
          ["-v, --version", "Print the version."],
        ]}
      />
      <P>
        <C>--json</C> is honoured by the four commands that report rather than act: <C>config</C>,{" "}
        <C>sessions</C>, <C>checkpoints</C> and <C>tools</C>. Use it from scripts; the human output
        is not a stable format.
      </P>

      <H2>Environment variables</H2>
      <H3>Models</H3>
      <Table
        head={["Variable", "What it does"]}
        rows={[
          ["ANTHROPIC_API_KEY", "Anthropic key."],
          ["OPENROUTER_API_KEY", "OpenRouter key."],
          ["OPENAI_API_KEY", "OpenAI, or OpenAI-compatible server, key."],
          ["DEVSTATION_PROVIDER", "anthropic | openrouter | openai"],
          ["DEVSTATION_MODEL", "The model, overriding config files."],
          ["DEVSTATION_BASE_URL", "The endpoint, overriding config files."],
          ["ANTHROPIC_MODEL / AI_MODEL", "Override the model without a flag."],
          ["DEVSTATION_MAX_TOKENS", "Reply ceiling per request (default 16,000)."],
          ["ANTHROPIC_MAX_TOKENS", "Cap the reply length."],
          ["ANTHROPIC_EFFORT / AI_REASONING", "Reasoning effort, for models that take one."],
          ["AGENT_INPUT_COST, AGENT_OUTPUT_COST", "Per-million-token rates used by --budget."],
          ["AGENT_CACHE_READ_COST, AGENT_CACHE_WRITE_COST", "Cache rates used by --budget."],
        ]}
      />
      <H3>Sandbox</H3>
      <Table
        head={["Variable", "What it does"]}
        rows={[
          ["DEVSTATION_SANDBOX=off", "Run commands on this machine. Same as --no-sandbox."],
          ["DEVSTATION_SANDBOX_NETWORK=off", "Cut the container off from the internet."],
          ["DEVSTATION_SANDBOX_RUNTIME", "runc, where gVisor is unavailable."],
          ["DEVSTATION_SANDBOX_IMAGE", "Use a different sandbox image."],
        ]}
      />
      <H3>Everything else</H3>
      <Table
        head={["Variable", "What it does"]}
        rows={[
          ["GITHUB_TOKEN or GH_TOKEN", "Needed by devstation repo, with push rights."],
          ["DEVSTATION_NO_UPDATE_CHECK=1", "Turn off the daily update check."],
          ["DEVSTATION_INSTALL_DIR", "Where the install script puts the binary."],
          ["DEVSTATION_VERSION", "Which release the install script fetches."],
        ]}
      />

      <H2>Files it writes</H2>
      <P>Inside the workspace, and nowhere else:</P>
      <Code
        language="text"
        code={`.agent/sessions/           run records, written after every message
.agent/memory.db           the search index
.agent/PROJECT_MEMORY.md   what it has been told (unless one exists at the root)
.agent/.gitignore          ignores itself, so none of it reaches your history
.devstation/checkpoints/   snapshot undo history, when there is no git
.devstation/repos/         repositories cloned by devstation repo
.devstation/config.json    per-project settings, if you set any
.devstation/mcp.json       per-project MCP servers, if you add them
.devstation/skills/        per-project skills, if you add them`}
      />
      <P>In your home directory:</P>
      <Code
        language="text"
        code={`~/.devstation/config.json        global settings, after login
~/.devstation/credentials.json   API keys, readable only by you
~/.devstation/mcp.json           global MCP servers, if you add them
~/.devstation/skills/            global skills, if you add them
~/.devstation/bin/devstation     the binary, if you used the install script`}
      />
    </DocPage>
  );
}
