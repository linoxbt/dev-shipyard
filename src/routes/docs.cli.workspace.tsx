import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { DocPage, H2, H3, P, Code, Callout, C } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/workspace")({
  head: () => ({ meta: [{ title: "Undo, Memory & MCP · DevStation CLI" }] }),
  component: CliWorkspace,
});

function CliWorkspace() {
  return (
    <DocPage
      title="Undo, Memory & MCP"
      icon={History}
      intro="How the agent keeps a way back from every change, finds its way around a large project, remembers what it cannot derive, and uses tools from MCP servers."
    >
      <H2>Undo</H2>
      <P>
        The agent checkpoints after any turn that changed a file, so there is always a way back.
      </P>
      <Code
        code={`devstation checkpoints    # what it can rewind to
devstation undo           # rewind one turn
devstation diff           # everything it has changed since the run started`}
      />
      <H3>In a git repository</H3>
      <P>
        A checkpoint is a real commit, with a subject starting <C>agent checkpoint:</C>. <C>undo</C>{" "}
        resets back one of them, and only ever rewinds commits the agent made: a commit of yours on
        top is never discarded. Find them with:
      </P>
      <Code code="git log --oneline --grep='^agent checkpoint:'" />
      <H3>Without git</H3>
      <P>
        A checkpoint is a file snapshot under <C>.devstation/checkpoints/</C>, taken before the
        turn&apos;s changes land. <C>undo</C> restores the files and removes anything the turn
        added. Twenty are kept. <C>diff</C> needs git, because a snapshot holds no base to compare
        against; it says so and points you at <C>checkpoints</C>.
      </P>

      <H2>Search index</H2>
      <Code code="devstation index" />
      <P>
        <C>index</C> walks the project and builds a BM25 index at <C>.agent/memory.db</C>, so the
        agent can find the one file that matters in a repository too big to read. The first run pays
        for the walk; after that only what changed is re-read. The first message in a new folder
        builds it for you.
      </P>

      <H2>Project memory</H2>
      <Code code="devstation memory" />
      <P>
        The index knows what the code says. Memory holds what the code cannot tell it: that deploys
        go out on Fridays, or that the obvious fix was already tried and did not work. The agent
        appends to it through a tool; entries are dated, nothing is rewritten, and you can read or
        edit it by hand.
      </P>
      <P>
        It lives in <C>.agent/PROJECT_MEMORY.md</C>. Put a <C>PROJECT_MEMORY.md</C> at your project
        root and that is used instead: its presence says you want these notes checked in and shared.
        The agent will not create that file itself.
      </P>

      <H2>MCP servers</H2>
      <P>
        Tools from{" "}
        <a
          href="https://modelcontextprotocol.io"
          className="text-primary hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          MCP
        </a>{" "}
        servers are offered to the agent alongside the built-in ones, named <C>server__tool</C> so
        two servers cannot shadow each other or a built-in.
      </P>
      <P>
        Servers are read from <C>.devstation/mcp.json</C> in the project, then{" "}
        <C>~/.devstation/mcp.json</C>. The nearer file wins, so a project has the last word about
        its own servers.
      </P>
      <Code
        language="json"
        code={`{
  "mcpServers": {
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./app.db"],
      "env": { "LOG_LEVEL": "warn" },
      "disabled": false
    }
  }
}`}
      />
      <P>
        <C>disabled: true</C> skips one without removing it.
      </P>
      <Callout tone="tip">
        <C>devstation mcp</C> lists what is configured and every tool each server actually offers.
        It is the quickest way to see whether a server is starting at all.
      </Callout>
    </DocPage>
  );
}
