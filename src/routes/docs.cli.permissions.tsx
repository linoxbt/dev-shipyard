import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { DocPage, H2, H3, P, Code, Callout, C, Table, Bullets } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/permissions")({
  head: () => ({ meta: [{ title: "Permissions & Sandbox · DevStation CLI" }] }),
  component: CliPermissions,
});

function CliPermissions() {
  return (
    <DocPage
      title="Permissions & Sandbox"
      icon={ShieldCheck}
      intro="The agent does ordinary development without interrupting you, asks before anything risky, and runs its shell commands in a container that cannot reach the rest of your machine."
    >
      <H2>What it asks permission for</H2>
      <P>
        Reading, searching, editing files and running the tests happen without asking. A tool that
        interrupts you for ordinary work gets its prompts clicked through without being read, which
        is worse than not asking.
      </P>
      <P>
        It asks before anything that loses data, spends money, changes who can get in, or reaches
        production. It shows the exact command and asks you to choose, with the arrow keys and
        Enter, or by pressing the number or letter beside an answer. Esc means no.
      </P>
      <Table
        head={["Answer", "Means"]}
        rows={[
          ["1 · Yes, proceed (y)", "Allow it once."],
          [
            "2 · Yes, and don't ask again this session (a)",
            "Allow that action, on that target, for the rest of the session.",
          ],
          ["3 · No, skip it (n), or Esc", "No. The agent carries on without it."],
        ]}
      />
      <P>
        “Always” is remembered per action and what it touches, so saying it to <C>ls</C> does not
        approve <C>npm install</C>. Chains of read-only commands such as{" "}
        <C>ls -a; cat package.json | grep version</C> do not ask at all.
      </P>

      <H2>Autonomy levels</H2>
      <P>
        <C>--autonomy</C> moves the line between what proceeds and what asks. There is a floor it
        cannot move.
      </P>
      <Table
        head={["Mode", "What proceeds unattended"]}
        rows={[
          ["ask_sensitive (default)", "Ordinary development only. Everything gated asks."],
          [
            "ask_integrations",
            "Ordinary work, plus medium-risk integration work: adding a dependency, writing config, creating a repository.",
          ],
          ["ask_deploy", "Everything except deploys and anything critical."],
          ["autonomous", "Everything except critical."],
        ]}
      />
      <Callout tone="warning" title="Critical always asks">
        Deleting a project, reading stored credentials, running an arbitrary shell command and
        rewinding git history always ask, whatever the setting. <C>-y</C> and <C>/approve</C>{" "}
        approve gated actions; they do not lower that floor.
      </Callout>
      <P>
        Two things it cannot do at all: push, and open a pull request. It proposes; you decide, with
        the diff in front of you. <C>devstation tools</C> prints every tool and which side of the
        line it falls on, for the settings you would actually run with.
      </P>

      <H2>The sandbox</H2>
      <P>
        Shell commands run inside a container, not directly on your machine. It is on by default.
      </P>
      <Bullets
        items={[
          "The workspace is mounted and writable. The rest of your machine is not reachable from inside.",
          "The container has internet access, so the agent can install packages, clone repositories and run builds.",
          "Files it writes come out owned by you, not by root.",
        ]}
      />
      <H3>Set it up</H3>
      <P>
        It needs Docker and, by default,{" "}
        <a
          href="https://gvisor.dev"
          className="text-primary hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          gVisor
        </a>{" "}
        (<C>runsc</C>) as the runtime, which puts a user-space kernel between the container and your
        machine. Build the image once:
      </P>
      <Code code="bun run sandbox:image        # docker build -t devstation-sandbox:1 -f docker/sandbox.Dockerfile docker" />
      <P>
        If Docker, the runtime or the image is missing, the CLI refuses to start and names the fix,
        rather than quietly running your commands unsandboxed.
      </P>
      <H3>Variations</H3>
      <Code
        code={`DEVSTATION_SANDBOX_NETWORK=off devstation     # no internet inside the container
DEVSTATION_SANDBOX_RUNTIME=runc devstation    # weaker isolation, where gVisor is unavailable
DEVSTATION_SANDBOX_IMAGE=my-image devstation  # an image with extra toolchains
devstation --no-sandbox                       # run commands on this machine (DEVSTATION_SANDBOX=off)`}
      />
      <P>
        The banner always says which you got: the runtime, the user, and whether the container has
        internet access.
      </P>

      <H3>Running on the machine instead</H3>
      <P>
        Inside the container, this machine&apos;s logins are not available: the GitHub CLI, git
        credentials and cloud CLIs belong to your account on the machine, not to the sandbox. When
        the agent needs them, run it on the machine itself, and save the choice so it sticks:
      </P>
      <Code
        code={`devstation config set sandbox off     # every session on this machine
devstation config set sandbox off --project   # just this project
devstation config set sandbox on      # back to the container`}
      />
      <P>
        <C>--sandbox</C>, <C>--no-sandbox</C> and <C>DEVSTATION_SANDBOX</C> still override the saved
        choice for a single run.
      </P>

      <H2>Background commands</H2>
      <P>
        Anything that keeps running, such as a dev server, a local chain like <C>anvil</C>, or a
        watcher, is started in the background. The agent reads what it has printed with{" "}
        <C>shell_output</C> and stops it with <C>stop_shell</C>, and every background command ends
        when the session does. This works on the machine and inside the sandbox.
      </P>

      <H2>The web</H2>
      <P>Two tools, no key needed:</P>
      <Bullets
        items={[
          <>
            <C>web_search</C> searches the web and returns titles, links and snippets.
          </>,
          <>
            <C>fetch_url</C> reads one page, a README or an API reference as text.
          </>,
        ]}
      />
      <P>
        The agent uses them when a question needs current information, instead of answering from
        memory. Private network addresses are refused, and everything fetched is treated as data,
        never as instructions.
      </P>
    </DocPage>
  );
}
