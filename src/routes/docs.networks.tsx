import { createFileRoute } from "@tanstack/react-router";
import { Network } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Table,
  Callout,
  C,
  Bullets,
  ExternalLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/networks")({
  head: () => ({ meta: [{ title: "Networks · DevStation Docs" }] }),
  component: Networks,
});

function Networks() {
  return (
    <DocPage
      title="Networks"
      icon={Network}
      intro="DevStation is built for QIE and also supports BOT Chain. Pick a network in the sidebar and the whole console follows it: templates, deploys, the explorer and analytics all switch to match."
    >
      <H2>Supported networks</H2>
      <Table
        head={["Network", "Chain ID", "Token", "Default RPC", "Explorer"]}
        rows={[
          ["QIE Mainnet", "1990", "QIE", "rpc1mainnet.qie.digital", "mainnet.qie.digital"],
          ["QIE Testnet", "1983", "QIE", "rpc1testnet.qie.digital", "testnet.qie.digital"],
          ["BOT Chain Mainnet", "677", "BOT", "rpc.botchain.ai", "scan.botchain.ai"],
          ["BOT Chain Testnet", "968", "BOT", "rpc.bohr.life", "scan.bohr.life"],
        ]}
      />
      <P>
        All four are EVM networks. Contracts are Solidity, compiled in the browser, and deployed
        with any EVM wallet. Each runs a Blockscout-compatible explorer, so blocks, transactions,
        addresses and source verification all work natively. QIE Mainnet is where the console opens
        before you choose anything.
      </P>

      <H2>The selected network</H2>
      <P>
        The network in the sidebar is authoritative. Reads use its endpoints, and every transaction
        is sent to it. If your wallet is on a different chain, the console asks it to switch before
        anything is signed, so a deploy can never land on the wrong network by accident.
      </P>
      <P>
        Explorer links always name their network, for example <C>/explorer/mainnet</C> or{" "}
        <C>/explorer/bot-testnet</C>, so a link you share opens on the same chain for everyone.
      </P>

      <H2>What runs where</H2>
      <Table
        head={["Feature", "Where"]}
        rows={[
          ["Templates, Contract Editor, Code with AI", "Every network"],
          ["Explorer and Routebook", "Every network"],
          ["Marketplace listings, purchases and payouts", "QIE Mainnet"],
          ["QIE ID (.qie names)", "QIE Mainnet, whatever network is selected"],
          ["Leaderboard and analytics", "The selected network"],
          ["Overview ecosystem totals", "Every network, combined"],
        ]}
      />

      <H2>Gas</H2>
      <H3>Sponsored deploys on mainnet</H3>
      <P>
        On QIE Mainnet and BOT Chain Mainnet, DevStation can top your own wallet up with just enough
        native token to cover a deploy, so you can ship without buying gas first. Your wallet still
        signs and sends the transaction, so it stays the deployer of record.
      </P>
      <H3>Testnet faucets</H3>
      <P>
        Testnets are not sponsored. Each has a public faucet, linked from the wallet panel whenever
        a testnet is selected.
      </P>
      <H3>Buying gas</H3>
      <Bullets
        items={[
          <>
            QIE: <ExternalLink href="https://www.swap.dex.qie.digital/swap">QIE DEX</ExternalLink>
          </>,
          <>
            BOT: <ExternalLink href="https://dex.botchain.ai/#/swap">BOT DEX</ExternalLink>
          </>,
        ]}
      />

      <H2>Adding a network to your wallet</H2>
      <P>
        You rarely need to. When you connect, or when a transaction needs a different chain,
        DevStation asks the wallet to add and switch to it. To add one by hand, use the chain ID,
        RPC and explorer from the table above.
      </P>
      <Callout>
        QIE Testnet&apos;s primary RPC has had long outages while the chain itself kept running.
        DevStation falls back to the testnet explorer&apos;s own RPC automatically, so reads and
        transactions keep working. If your wallet reports the testnet as unreachable, point it at{" "}
        <C>https://testnet.qie.digital/api/eth-rpc</C>.
      </Callout>
    </DocPage>
  );
}
