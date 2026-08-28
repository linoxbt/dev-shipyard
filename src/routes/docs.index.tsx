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
      intro="DevStation is the AI Developer OS for QIE and Web3. Describe what you want built and the agent writes, tests, deploys and verifies it — or work by hand with templates, the in-browser Solidity editor, the transaction decoder and the explorer. No local toolchain required."
    >
      <P>
        Everything a QIE developer needs sits in one place: audited templates, a real in-browser
        Solidity compiler, an AI contract author, a transaction decoder, and a native block
        explorer. Nothing to install, and nothing that only works on someone else&apos;s machine.
      </P>
      <P>
        Pick a network once — QIE Testnet or Mainnet, or BOT Chain — and the whole console follows
        it: templates, the deploy flow, the explorer, and analytics all point at that network. The
        selected network is authoritative for every read and write.
      </P>
      <P>The console is organised into two products and a set of shared tools:</P>
      <CardGrid>
        <FeatureCard
          icon={Rocket}
          title="LaunchKit"
          body="Deploy audited templates, write contracts in the in-browser editor with real compilation, and generate them with AI."
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
