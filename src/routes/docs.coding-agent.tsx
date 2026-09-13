import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Table,
  Callout,
  Code,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/coding-agent")({
  head: () => ({ meta: [{ title: "Coding Agent · DevStation Docs" }] }),
  component: CodingAgentDocs,
});

function CodingAgentDocs() {
  return (
    <DocPage
      title="Coding Agent"
      icon={Bot}
      intro="One agent for everything: describe what you want and it writes the code, runs it in a sandbox, tests it and shows you the result. It is the DevStation CLI's agent, in your browser. No GitHub account is needed until you choose to push."
    >
      <H2>Start</H2>
      <Steps
        steps={[
          {
            title: "Open the Coding Agent and connect a wallet",
            body: (
              <P>
                Open <ConsoleLink to="/launchkit/coding-agent">Coding Agent</ConsoleLink>. The first
                message asks your wallet for one signature, which costs no gas. It is what lets you
                come back to your work from any tab.
              </P>
            ),
          },
          {
            title: "Choose where to start",
            body: (
              <Table
                head={["Start from", "What happens"]}
                rows={[
                  ["Nothing", "An empty workspace."],
                  [
                    "A repository",
                    "Any public GitHub repository, as owner/name or its URL. No sign-in. Private repositories work once GitHub is connected.",
                  ],
                  [
                    "Your files",
                    "Pick a folder. Text files are copied in; dependencies, build output and binaries are left out.",
                  ],
                  ["One of your apps", "Pick it from the project switcher at the top of the chat."],
                ]}
              />
            ),
          },
          {
            title: "Say what you want",
            body: (
              <P>
                “Build a token-gated page for QIE holders”, “write and test an ERC-20 with a
                faucet”, “fix the failing test in src/total.test.js”. Then keep talking: every
                message continues in the same workspace, and the agent remembers the conversation.
              </P>
            ),
          },
        ]}
      />

      <H2>What it can do</H2>
      <Bullets
        items={[
          "Read, write and edit any file in the workspace.",
          "Run shell commands: scaffold projects, install packages, run builds, linters and tests.",
          "Search the web and read documentation pages.",
          "Build web apps, smart contracts, APIs, scripts, libraries and command-line tools.",
          "Verify its own work before it says it is done.",
        ]}
      />
      <P>
        It works in a sandboxed container on DevStation&apos;s runner, not in your browser, so a run
        keeps going if you close the tab. Come back and the conversation is where you left it.
      </P>

      <H2>The panel beside the chat</H2>
      <Table
        head={["Tab", "Shows"]}
        rows={[
          [
            "Preview",
            "Anything with a web page, rebuilt after each turn: a static index.html, or a project whose npm run build writes to dist/.",
          ],
          ["Files", "Every file in the workspace. Files changed in the last turn are highlighted."],
          [
            "Activity",
            "Each command and edit of the latest turn, and what the work has cost so far.",
          ],
        ]}
      />

      <H2>When you are happy with it</H2>
      <Table
        head={["Action", "Needs"]}
        rows={[
          ["Download", "Nothing. A zip of every file."],
          [
            "Publish",
            <>
              A wallet. Puts the built page live at <C>&lt;name&gt;.devstation.online</C>.
            </>,
          ],
          ["Push", "GitHub. Creates a new repository with the files."],
          [
            "Pull request",
            "GitHub, and a workspace that started from a repository. Opens a branch against it.",
          ],
          ["Sell", "A wallet. List it on the Marketplace."],
        ]}
      />
      <P>
        Push and pull request ask you to connect GitHub the first time, then bring you straight
        back. The agent may suggest pushing or publishing; it cannot do either itself. You confirm
        with a button and your own account does it.
      </P>

      <Callout title="Nothing reaches GitHub without you">
        The agent never holds a GitHub credential. Your GitHub session stays on DevStation&apos;s
        server, and it is only used when you press Push or Open pull request.
      </Callout>

      <H3>Limits</H3>
      <Bullets
        items={[
          "An import or upload can bring in up to 12 MB of text.",
          "Previews build projects of up to 200 files and 2 MB; larger ones can be downloaded and run locally.",
          "A single turn stops after about 20 minutes or 60 steps.",
          "Workspaces are kept for three days after you last used them, and are recreated from your saved files after that.",
        ]}
      />

      <H2>The same agent in your terminal</H2>
      <P>For work on your own machine, with your own tools, install the CLI:</P>
      <Code code={`npm install -g @devstationlabs/cli\ndevstation`} />
      <P>
        See <DocLink to="/docs/cli/install">Install the CLI</DocLink>.
      </P>
    </DocPage>
  );
}
