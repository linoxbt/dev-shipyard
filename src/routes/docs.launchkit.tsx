import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, H3, Table, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";
import { useTerminology } from "@/lib/terminology";

export const Route = createFileRoute("/docs/launchkit")({
  head: () => ({ meta: [{ title: "Templates & Deploy - DevStation Docs" }] }),
  component: LaunchKit,
});

function LaunchKit() {
  const { t } = useTerminology();
  const { prev, next } = docNeighbors("/docs/launchkit");
  return (
    <DocPage
      title="Templates & Deploy"
      intro={t(
        "LaunchKit is the deployment surface. It ships with self-contained, audited Solidity templates \u2014 ERC-20 tokens, NFTs, staking, vesting, governance and more \u2014 that compile with no external dependencies, so a deploy is fast and predictable.",
      )}
    >
      <Table
        head={["Template", "Category", "What it is"]}
        rows={[
          [
            t("ERC-20 Token"),
            "Token",
            "A standard fungible token (ERC-20) with mint and burn. Contract: SimpleERC20.",
          ],
          [
            t("NFT Collection"),
            "NFT",
            "A standard NFT collection (ERC-721) with metadata. Contract: SimpleERC721.",
          ],
          [
            t("Soulbound NFT"),
            "NFT",
            "A non-transferable, identity-bound NFT. Contract: SoulboundNFT.",
          ],
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
        and the built-in explorer.
      </P>
      <Callout>
        You can also submit your own template to the community catalog from the Templates page. It
        becomes available to deploy like any built-in.
      </Callout>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
