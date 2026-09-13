import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Callout,
  Code,
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
      intro="Describe what you want and the agent builds it. Start from nothing and get a working app you can publish, or point it at a GitHub repository and get a pull request you decide on."
    >
      <P>
        Open <ConsoleLink to="/launchkit/coding-agent">Coding Agent</ConsoleLink> in the sidebar and
        choose a mode: <strong className="text-foreground">New app</strong> or{" "}
        <strong className="text-foreground">Repository</strong>. The console remembers which you
        used last.
      </P>

      <H2>Build a new app</H2>
      <Steps
        steps={[
          {
            title: "Add an AI key",
            body: (
              <P>
                The agent uses your provider. Add a key in the AI settings on the{" "}
                <ConsoleLink to="/launchkit/ai">Code with AI</ConsoleLink> page first; see{" "}
                <DocLink to="/docs/ai">providers and keys</DocLink>.
              </P>
            ),
          },
          {
            title: "Describe the app",
            body: (
              <P>
                For example, “a token swap interface for QIE with a wallet connect button”. The
                agent writes the files and the app runs in the preview as it goes.
              </P>
            ),
          },
          {
            title: "Keep talking to change it",
            body: (
              <P>
                Ask for changes the way you would ask a colleague. If the preview breaks, say so and
                it is fixed. The conversation and the files are saved, so you can close the tab and
                come back.
              </P>
            ),
          },
          {
            title: "Publish or push",
            body: (
              <P>
                Publish it to its own address at <code>&lt;name&gt;.devstation.online</code>, push
                the files to GitHub, or list it on the Marketplace. See{" "}
                <DocLink to="/docs/apps">Apps &amp; Publishing</DocLink>.
              </P>
            ),
          },
        ]}
      />
      <H3>Review mode</H3>
      <P>
        Ask the agent to read the code over and it reports what it finds without editing anything.
        Use it before you publish, or on an app you bought.
      </P>

      <H2>Work on a GitHub repository</H2>
      <Steps
        steps={[
          {
            title: "Connect GitHub",
            body: (
              <P>
                Click <strong className="text-foreground">Connect GitHub</strong> and approve
                DevStation. The token is kept in a secure cookie that the page itself cannot read.
              </P>
            ),
          },
          {
            title: "Pick a repository",
            body: (
              <P>
                Choose from the repositories you can push to, or type <code>owner/name</code> for
                one you have access to.
              </P>
            ),
          },
          {
            title: "Say what it should do",
            body: (
              <P>
                Be specific about the outcome: “Fix the failing test in src/total.test.js. Change
                the source, not the test.”
              </P>
            ),
          },
          {
            title: "Watch it work",
            body: (
              <P>
                It reads the repository, edits, and verifies its work in an isolated sandbox on
                DevStation&apos;s build runner. Binary and very large files are left out of what it
                reads, and it tells you how many.
              </P>
            ),
          },
          {
            title: "Read the diff, then decide",
            body: (
              <P>
                When it finishes you see every changed file. The button that opens a pull request
                only appears once there is a finished run with changes in it; nothing reaches GitHub
                until you press it.
              </P>
            ),
          },
        ]}
      />

      <Callout title="Nothing is pushed without you">
        The agent never pushes to a branch you have, and never merges. It proposes one pull request,
        after you have seen the change.
      </Callout>

      <H2>The same agent in your terminal</H2>
      <P>
        For work on your own machine, with your own tools and tests, use the DevStation CLI. It runs
        the same loop against a local folder:
      </P>
      <Code code={`npm install -g @devstationlabs/cli\ndevstation doctor`} />
      <Bullets
        items={[
          <>
            <DocLink to="/docs/cli/install">Install the CLI</DocLink>
          </>,
          <>
            <DocLink to="/docs/cli/sessions">Work on a repository from the terminal</DocLink> with{" "}
            <code>devstation repo</code>
          </>,
        ]}
      />
    </DocPage>
  );
}
