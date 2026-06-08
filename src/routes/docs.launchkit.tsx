import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, H3, Table, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/launchkit")({
  head: () => ({ meta: [{ title: "Templates & Deploy - DevStation Docs" }] }),
  component: LaunchKit,
});

function LaunchKit() {
  const { prev, next } = docNeighbors("/docs/launchkit");
  return (
    <DocPage
      title="Templates & Deploy"
      intro="LaunchKit is the deployment surface. It ships with self-contained, audited templates that compile with no external dependencies, so a deploy is fast and predictable."
    >
      <Table
        head={["Template", "Category", "What it is"]}
        rows={[
          ["SimpleERC20", "Token", "A standard fungible token with mint and burn."],
          ["SimpleERC721", "NFT", "A standard NFT collection with metadata."],
          ["SoulboundNFT", "NFT", "A non-transferable, identity-bound NFT."],
          ["MultiSigWallet", "Governance", "An m-of-n multi-signature wallet."],
          ["TimelockController", "Governance", "Queue and execute calls after a delay."],
          ["TokenVesting", "DeFi", "Linear token vesting with a cliff."],
          ["SimpleStaking", "DeFi", "Stake a token and earn rewards."],
          ["PaymentSplitter", "Utility", "Split incoming funds among payees."],
        ]}
      />
      <H3>The deploy flow</H3>
      <P>
        Selecting a template opens a guided form generated from its constructor. DevStation
        validates and encodes the arguments, compiles the source in a browser worker, and sends the
        creation transaction through your wallet. On success you get the contract address, the
        transaction hash, the block, a downloadable .env file, and one-click links into Routebook
        and the QIE explorer.
      </P>
      <Callout>
        You can also submit your own template to the community catalog from the Templates page. It
        becomes available to deploy like any built-in.
      </Callout>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
