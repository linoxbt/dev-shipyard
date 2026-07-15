import { createFileRoute } from "@tanstack/react-router";
import { Rocket, Search, Compass, FolderGit2 } from "lucide-react";
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
      intro="DevStation is a multichain developer console spanning 4 EVM chains — QIE, BOT Chain, Arc, and GOAT Network. Deploy contracts from audited templates, write and compile Solidity in the browser, decode any transaction, and label contracts onchain."
    >
      <P>
        DevStation brings the everyday work of a smart-contract developer into one console: writing,
        compiling, deploying, inspecting, and labeling contracts across every supported chain.
        Everything runs against live networks, and the records that matter (your deployments and the
        contract label registry) live onchain, per chain, not in a private database.
      </P>
      <P>The console is organized into two products and a set of shared tools:</P>
      <CardGrid>
        <FeatureCard
          icon={Rocket}
          title="LaunchKit"
          body="Deploy audited contract templates, write your own Solidity in the in-browser editor, and generate contracts with AI — on any supported chain."
          to="/launchkit/templates"
        />
        <FeatureCard
          icon={Search}
          title="Routebook"
          body="Decode any transaction, on any supported chain, into a readable call tree with events, internal calls, and onchain contract labels."
          to="/routebook"
        />
        <FeatureCard
          icon={Compass}
          title="Explorer"
          body="A built-in block explorer for blocks, transactions, and addresses across every supported chain, without leaving the console."
          to="/explorer"
        />
        <FeatureCard
          icon={FolderGit2}
          title="Projects"
          body="A per-wallet history of every contract you have deployed through DevStation, backed by the onchain ProjectRegistry on each chain."
          to="/launchkit/projects"
        />
      </CardGrid>
      <PageNav next={next} />
    </DocPage>
  );
}
