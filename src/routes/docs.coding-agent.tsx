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
                “Build a token-gated page for my NFT holders”, “write and test an ERC-20 with a
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

      <H2>The conversation</H2>
      <P>
        While the agent works you see its checklist for the task and every step as it happens: each
        file it reads or writes and each command it runs. Open a command to see exactly what it
        printed. When a turn ends its steps fold into one line, and the files it changed appear as
        chips: click one to open it in Code.
      </P>

      <H2>Preview, Code and Activity</H2>
      <Table
        head={["View", "Shows"]}
        rows={[
          [
            "Preview",
            "Anything with a web page, rebuilt after each turn: a static index.html, or a project whose npm run build writes to dist/. Switch between desktop, tablet and phone widths. If the running app reports an error, Fix with agent sends it to the agent.",
          ],
          [
            "Code",
            "Every file in the workspace as a tree, with syntax highlighting. Files changed in the last turn carry a dot, and one click shows only those.",
          ],
          [
            "Activity",
            "Each command and edit of the latest turn with its output, and what the work has cost so far.",
          ],
        ]}
      />
      <P>
        The menu at the top left lists your projects, starts a new one and opens templates; your
        workspace (wallet, projects saved, browser storage) is at its foot. The ••• button holds
        everything you can do with the open project: publish, invite builders, push to GitHub,
        download, remix, rename, sell or delete. On a phone, the tabs along the bottom switch
        between the chat, the preview, the code and the activity.
      </P>

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
