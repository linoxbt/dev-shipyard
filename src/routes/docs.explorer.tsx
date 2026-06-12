import { createFileRoute } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { DocPage, H2, P, Bullets, Steps, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/explorer")({
  head: () => ({ meta: [{ title: "QIE Explorer - DevStation Docs" }] }),
  component: ExplorerDocs,
});

function ExplorerDocs() {
  const { prev, next } = docNeighbors("/docs/explorer");
  return (
    <DocPage
      title="QIE Explorer"
      icon={Compass}
      intro="A native, Etherscan-style block explorer for QIE, built into DevStation. It reads the live chain and is scoped to the network in the URL, so a link always names its chain."
    >
      <P>
        Open it at <code>/explorer/testnet</code> or <code>/explorer/mainnet</code> (the bare{" "}
        <code>/explorer</code> redirects to your selected network). A prominent Testnet/Mainnet
        badge in the header makes the active chain unmistakable.
      </P>

      <H2>Dashboard</H2>
      <P>The home view shows live network health at a glance:</P>
      <Bullets
        items={[
          "QIE price, market cap, average block time, total blocks and transactions, gas price, and network utilization",
          "Daily-transactions and QIE-price charts (30-day)",
          "Live feeds of the latest blocks and transactions",
          "A universal search for an address, transaction hash, or block number",
        ]}
      />

      <H2>Pages</H2>
      <Bullets
        items={[
          "Transaction: status, block and confirmations, from/to, token transfers, value, fee, gas, EIP-1559 detail, nonce, event logs, and decoded or raw input",
          "Block: height with prev/next, miner, reward, gas used and limit, base fee, burnt fees, size, and the block's transactions",
          "Address: balance and fiat value, counters, creator, and tabs for Transactions, Token Transfers, Tokens held, Internal Txns, and Logs",
          "Token: supply, holders, transfers, and decimals, with ranked holders and ownership percentages",
        ]}
      />

      <H2>Verified contracts</H2>
      <P>
        When a contract is verified, its Contract tab opens the full developer view, the same set
        you would expect from Etherscan:
      </P>
      <Bullets
        items={[
          "Code: compiler version, EVM version, optimization, license, and the source",
          "Read Contract / Write Contract: call view functions and send transactions with your wallet, straight from the explorer",
          "ABI: the full ABI, copyable",
          "ByteCode: deployed and creation bytecode (shown even for unverified contracts)",
        ]}
      />

      <H2>Verify a contract</H2>
      <P>
        Any unverified contract links to a built-in verification form (also reachable from the
        Verify Contract link in the explorer header). Publish your source in a few steps:
      </P>
      <Steps
        steps={[
          { title: "Open the form", body: "From an unverified contract, or the header link." },
          {
            title: "Fill the details",
            body: "Contract address, compiler version, optimization and runs, license, and your flattened Solidity source.",
          },
          {
            title: "Submit",
            body: "DevStation sends it to the QIE explorer and polls until it confirms, then links to the verified contract.",
          },
        ]}
      />
      <Callout tone="info">
        Source must be a single flattened file with all imports inline. For contracts that import
        OpenZeppelin, use the Contract Editor to produce the flattened source first.
      </Callout>

      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
