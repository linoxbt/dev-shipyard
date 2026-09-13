import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Code,
  Callout,
  C,
  Table,
  Steps,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/install")({
  head: () => ({ meta: [{ title: "Install the CLI · DevStation Docs" }] }),
  component: CliInstall,
});

function CliInstall() {
  return (
    <DocPage
      title="Installation"
      icon={Download}
      intro="Three ways to install, all verified against the same published checksums. Pick one, then run devstation doctor."
    >
      <H2>Install</H2>
      <H3>With npm</H3>
      <Code code="npm install -g @devstationlabs/cli" />
      <P>
        Needs nothing else on the machine. The package downloads the standalone binary for your
        platform at install time and checks it against the published <C>SHA256SUMS</C>; if that does
        not match, nothing is installed.
      </P>
      <P>
        Two cases fall back to running the bundled JavaScript through{" "}
        <a
          href="https://bun.sh"
          className="text-primary hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Bun
        </a>
        : installing with <C>--ignore-scripts</C>, which skips the download, and a platform with no
        published binary. If neither route works, the command tells you which and what to do.
      </P>
      <Callout tone="warning" title="Use the scoped name">
        <p>
          <C>devstation</C> on npm without the scope is an unrelated package, a dashboard for dev
          servers. <C>npm i -g devstation</C> installs that, not this.
        </p>
        <p>
          If you already installed it, <C>devstation config</C> prints a box about{" "}
          <C>http://localhost:4000</C>. Remove it with <C>npm uninstall -g devstation</C>, then run{" "}
          <C>hash -r</C> so your shell forgets the old path.
        </p>
      </Callout>

      <H3>With the install script (macOS and Linux)</H3>
      <Code code="curl -fsSL https://devstation.online/install.sh | sh" />
      <P>
        It downloads the binary for your platform, checks it against <C>SHA256SUMS</C>, and installs
        nothing if they differ. The binary goes to <C>~/.devstation/bin/devstation</C>, and the
        installer tells you if that directory is not on your <C>PATH</C>.
      </P>
      <P>Pick a version, or install somewhere else:</P>
      <Code
        code={`DEVSTATION_VERSION=v0.2.2 curl -fsSL https://devstation.online/install.sh | sh
DEVSTATION_INSTALL_DIR=/usr/local/bin curl -fsSL https://devstation.online/install.sh | sh`}
      />

      <H3>By hand</H3>
      <P>Every release carries five binaries and their checksums:</P>
      <Code
        code={`cd /tmp
curl -fLO https://github.com/linoxbt/dev-shipyard/releases/latest/download/devstation-linux-x64
curl -fLO https://github.com/linoxbt/dev-shipyard/releases/latest/download/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
mkdir -p ~/.devstation/bin
install -m755 devstation-linux-x64 ~/.devstation/bin/devstation`}
      />
      <Table
        head={["Platform", "File"]}
        rows={[
          ["Linux x64", "devstation-linux-x64"],
          ["Linux arm64", "devstation-linux-arm64"],
          ["macOS Apple silicon", "devstation-darwin-arm64"],
          ["macOS Intel", "devstation-darwin-x64"],
          ["Windows x64", "devstation-windows-x64.exe"],
        ]}
      />

      <H2>Check the install</H2>
      <Code code={`devstation --version\ndevstation doctor`} />
      <P>
        <C>doctor</C> checks each thing a run needs, from the model provider to the sandbox image,
        and names the fix for anything missing. See{" "}
        <DocLink to="/docs/cli/troubleshooting">Troubleshooting</DocLink> for what each line means.
      </P>

      <H2>Set up in five minutes</H2>
      <Steps
        steps={[
          {
            title: "Install",
            body: <Code code="npm install -g @devstationlabs/cli" />,
          },
          {
            title: "Choose a model",
            body: (
              <>
                <Code code="devstation login" />
                <P>
                  Pick a provider, paste the key (hidden as you type), and pick a model. See{" "}
                  <DocLink to="/docs/cli/models">Models &amp; Providers</DocLink>.
                </P>
              </>
            ),
          },
          {
            title: "Build the sandbox image",
            body: (
              <>
                <P>
                  Shell commands run in a Docker container. With Docker installed, build the image
                  once from a checkout of the repository:
                </P>
                <Code code="bun run sandbox:image" />
                <P>
                  Or skip the container for now with <C>--no-sandbox</C>. See{" "}
                  <DocLink to="/docs/cli/permissions">the sandbox</DocLink>.
                </P>
              </>
            ),
          },
          {
            title: "Check everything",
            body: <Code code="devstation doctor" />,
          },
          {
            title: "Start",
            body: <Code code={`cd your-project\ndevstation`} />,
          },
        ]}
      />

      <Callout tone="tip" title="Command not found?">
        <p>
          The install directory is not on your <C>PATH</C>. The installer prints the line to add;
          for the default location it is:
        </p>
        <Code
          code={`echo 'export PATH="$HOME/.devstation/bin:$PATH"' >> ~/.profile && . ~/.profile`}
        />
      </Callout>
    </DocPage>
  );
}
