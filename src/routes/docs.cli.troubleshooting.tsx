import { createFileRoute } from "@tanstack/react-router";
import { Stethoscope } from "lucide-react";
import { DocPage, H2, H3, P, Code, C, Table, Bullets } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/troubleshooting")({
  head: () => ({ meta: [{ title: "Troubleshooting · DevStation CLI" }] }),
  component: CliTroubleshooting,
});

function CliTroubleshooting() {
  return (
    <DocPage
      title="Troubleshooting"
      icon={Stethoscope}
      intro="Start with devstation doctor. If that does not explain it, find the symptom below. Then how to upgrade, and how to remove everything."
    >
      <H2>devstation doctor</H2>
      <P>It checks each thing a run needs and names the fix for whatever is missing:</P>
      <Code
        language="text"
        code={`no  model provider   set ANTHROPIC_API_KEY, or OPENROUTER_API_KEY
ok  git              git version 2.43.0
ok  workspace        /home/you/project (a git repository)
ok  write access     the agent can edit files here
ok  runtime          bun 1.3.14
ok  docker           reachable
ok  isolation        runsc, a user-space kernel between commands and this host
ok  sandbox image    devstation-sandbox:1, running as 1000:1000 (your uid)`}
      />
      <P>
        <C>devstation config</C> shows exactly what a run would use: the provider and model it
        resolved, where each came from, and whether the sandbox is on. <C>devstation sessions</C> is
        the history of past runs, and <C>status -f</C> follows a live one.
      </P>

      <H2>Symptoms</H2>
      <Table
        head={["Symptom", "What it is"]}
        rows={[
          [
            "devstation config prints a box about localhost:4000",
            "A different npm package called devstation is first on your PATH. Remove it with npm uninstall -g devstation, then hash -r.",
          ],
          [
            "command not found after installing",
            "~/.devstation/bin is not on your PATH. The installer prints the line to add.",
          ],
          [
            "No such file or directory: /usr/local/bin/devstation",
            "Your shell cached the path of a devstation that has since been removed. Run hash -r, or open a new terminal.",
          ],
          [
            "Refuses to start, naming Docker or the image",
            "The sandbox is unavailable. Build it with bun run sandbox:image, or accept the risk with --no-sandbox.",
          ],
          [
            "Every shell command fails to reach the network",
            "DEVSTATION_SANDBOX_NETWORK=off is set. Unset it, or let the agent use install_dependency and fetch_url.",
          ],
          [
            "A warning that the sandbox image has no cargo, go or python3",
            "The project uses a toolchain the image lacks. Build an image with it and set DEVSTATION_SANDBOX_IMAGE, or use --no-sandbox.",
          ],
          [
            "Slow first answer in a very large folder",
            "The first turn builds the search index. It skips caches and stops after 20,000 files or 10 seconds, then answers.",
          ],
          [
            "On Windows, a warning that credentials.json is readable by others",
            "A false alarm before 0.2.1: Windows reports every file that way. Upgrade to stop it.",
          ],
          [
            "A run stops saying it reached its budget",
            "--budget was hit. Raise it, or lower --max-steps if it is looping.",
          ],
          [
            "A turn says it only half happened",
            "Some tool calls failed after others had written. Nothing is rolled back on purpose; read what it says and decide.",
          ],
          [
            "It will not push or open a pull request",
            "By design. Run devstation diff, then do it yourself.",
          ],
          [
            "A session seems stuck",
            "devstation status -f from another terminal shows the live steps.",
          ],
          [
            "It crashed mid-run",
            "devstation resume. Sessions are written to .agent/ after every message.",
          ],
        ]}
      />

      <H2>Upgrading</H2>
      <Code
        code={`devstation upgrade            # update to the latest version
devstation upgrade --check    # only say whether one exists`}
      />
      <P>It knows how it was installed and does the matching thing:</P>
      <Table
        head={["Installed with", "What upgrade does"]}
        rows={[
          ["npm", "Runs npm install -g @devstationlabs/cli@<latest>."],
          [
            "The install script, or a release binary",
            "Downloads the new binary, checks it against SHA256SUMS, and replaces itself. A mismatch changes nothing.",
          ],
          ["A source checkout", "Tells you to git pull."],
        ]}
      />
      <P>
        You can always do it by hand instead: <C>npm install -g @devstationlabs/cli@latest</C>, or
        run the install script again. After an npm upgrade, run <C>hash -r</C> if your shell still
        finds the old version.
      </P>
      <P>
        Once a day it checks whether a newer version exists and prints one line if so. The answer is
        cached, so there is never a network request in front of your first prompt. It is off in CI,
        and <C>DEVSTATION_NO_UPDATE_CHECK=1</C> turns it off anywhere.
      </P>

      <H2>Uninstalling</H2>
      <H3>The CLI</H3>
      <Code
        code={`npm uninstall -g @devstationlabs/cli          # if installed with npm
rm -rf ~/.devstation                           # binary, settings, keys, global skills and MCP
sed -i '/\\.devstation\\/bin/d' ~/.profile       # macOS: sed -i '' '/\\.devstation\\/bin/d' ~/.profile`}
      />
      <H3>Per-project state</H3>
      <Code code="rm -rf .agent .devstation" />
      <H3>The sandbox image</H3>
      <Code
        code={`docker rmi devstation-sandbox:1
docker ps -aq --filter name=devstation-agent- | xargs -r docker rm -f`}
      />
      <P>Three things deliberately survive:</P>
      <Bullets
        items={[
          <>
            <C>PROJECT_MEMORY.md</C> at a project root is yours. It is only there if you created it.
          </>,
          <>
            Git checkpoint commits are real commits. Run <C>devstation undo</C> first if you want
            them rewound.
          </>,
          <>
            Your <C>.gitignore</C> was never edited.
          </>,
        ]}
      />
    </DocPage>
  );
}
