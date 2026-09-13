import { createFileRoute, Link } from "@tanstack/react-router";
import { Terminal, ArrowRight } from "lucide-react";
import {
  DocPage,
  H2,
  P,
  Bullets,
  Code,
  Table,
  DocLink,
  Callout,
} from "@/components/docs/primitives";
import { DOC_NAV } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/cli/")({
  head: () => ({ meta: [{ title: "DevStation CLI · DevStation Docs" }] }),
  component: CliOverview,
});

function CliOverview() {
  const pages = DOC_NAV.find((g) => g.group === "DevStation CLI")?.items.slice(1) ?? [];
  return (
    <DocPage
      title="DevStation CLI"
      icon={Terminal}
      intro="The coding agent in your terminal. It reads a project, edits it, runs the tests and shows you what changed. Everything happens on your machine; nothing leaves it except the calls to the model you chose."
    >
      <Code
        code={`npm install -g @devstationlabs/cli\ndevstation login\ncd your-project\ndevstation`}
      />

      <H2>What it does</H2>
      <Bullets
        items={[
          "Opens a session in your project, like Claude Code or Codex. Say what you want; it plans, edits and verifies.",
          'Runs one job and exits, for scripts: devstation run "…".',
          "Works on a GitHub repository and finishes with a pull request you approve.",
          "Runs shell commands in a sandboxed container, not directly on your machine.",
          "Checkpoints after every turn that changes a file, so any change can be undone.",
          "Works with Anthropic, OpenRouter, OpenAI, or any OpenAI-compatible server such as Ollama.",
        ]}
      />

      <H2>How it decides what to ask you</H2>
      <P>
        Reading, searching, editing and running tests happen without asking: that is the ordinary
        work. It asks before anything that loses data, spends money, changes who can get in, or
        reaches production, and it can never push or open a pull request on its own. See{" "}
        <DocLink to="/docs/cli/permissions">Permissions &amp; Sandbox</DocLink>.
      </P>

      <H2>Requirements</H2>
      <Table
        head={["Need", "Details"]}
        rows={[
          ["An OS", "Linux (x64, arm64), macOS (Apple silicon, Intel), or Windows (x64)."],
          [
            "A model",
            "An API key for Anthropic, OpenRouter or OpenAI, or a local OpenAI-compatible server.",
          ],
          ["Docker", "For the sandbox, with gVisor preferred. Not needed with --no-sandbox."],
          ["git", "Optional, but checkpoints, undo and diff work best in a git repository."],
        ]}
      />

      <Callout>
        The binary carries its own runtime. You do not need Node, Bun or anything else installed to
        run it.
      </Callout>

      <H2>The guide</H2>
      <div className="grid gap-2 sm:grid-cols-2">
        {pages.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="group rounded-lg border border-border bg-surface p-4 transition hover:border-primary/50"
          >
            <span className="flex items-center justify-between text-sm font-semibold text-foreground">
              {p.label}
              <ArrowRight className="h-4 w-4 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">
              {p.description}
            </span>
          </Link>
        ))}
      </div>
    </DocPage>
  );
}
