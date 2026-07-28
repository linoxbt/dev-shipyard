import { createFileRoute } from "@tanstack/react-router";
import { Rocket, Search, Compass, FolderGit2, Wallet } from "lucide-react";
import { DocPage, P, CardGrid, FeatureCard, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/")({
  head: () => ({ meta: [{ title: "Introduction - DevStation Docs" }] }),
  component: Introduction,
});

function Introduction() {
  const { next } = docNeighbors("/docs");
  return (
    <DocPage
      title="Introduction"
      intro="DevStation is one developer console for every network you build on. Deploy from audited templates, write and compile contracts in the browser, decode any transaction, and explore the chain — without installing a local toolchain."
    >
      <P>
        Most tooling assumes a single chain, and usually a single virtual machine. DevStation does
        not. The same surfaces — templates, editor, AI, deploy, explorer — adapt to whichever network
        you select, in that network&apos;s own language and with its own wallet, while everything
        that should feel identical everywhere stays identical.
      </P>
      <P>
        Pick a network once and the whole console follows it: the editor switches language and
        compiler, the templates change to that ecosystem&apos;s standards, the deploy flow uses the
        right signing path, and the explorer and analytics point at the right data source. You never
        assemble a per-chain toolchain, and you never learn a second UI.
      </P>
      <P>The console is organised into two products and a set of shared tools:</P>
      <CardGrid>
        <FeatureCard
          icon={Rocket}
          title="LaunchKit"
          body="Deploy audited templates, write contracts in the in-browser editor with real compilation, and generate them with AI — on any supported network."
          to="/launchkit/templates"
        />
        <FeatureCard
          icon={Search}
          title="Routebook"
          body="Decode a transaction into a readable call tree: internal calls, decoded arguments, token movements, events, and revert reasons."
          to="/routebook"
        />
        <FeatureCard
          icon={Compass}
          title="Explorer"
          body="A built-in block explorer for blocks, transactions, addresses, and tokens across every supported network, without leaving the console."
          to="/explorer"
        />
        <FeatureCard
          icon={Wallet}
          title="Wallets"
          body="Connect an existing wallet, or generate a DevStation wallet in-app — every generated wallet shows its recovery phrase before you continue."
          to="/settings"
        />
        <FeatureCard
          icon={FolderGit2}
          title="Projects"
          body="A per-wallet history of everything you have shipped through DevStation, backed by onchain registries where the network supports them."
          to="/launchkit/projects"
        />
      </CardGrid>
      <P>
        Where networks genuinely differ, these docs say so rather than papering over it — different
        chains have different compilers, different wallet standards, and different ideas of what a
        &quot;contract&quot; even is. The Networks page is the reference for what each one supports.
      </P>
      <PageNav next={next} />
    </DocPage>
  );
}
