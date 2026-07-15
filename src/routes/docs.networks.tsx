import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, Table, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/networks")({
  head: () => ({ meta: [{ title: "Networks - DevStation Docs" }] }),
  component: Networks,
});

function Networks() {
  const { prev, next } = docNeighbors("/docs/networks");
  return (
    <DocPage
      title="Networks"
      intro="DevStation supports 4 EVM chains — QIE, BOT Chain, Arc, and GOAT Network — most with a Testnet and Mainnet. The selected network is authoritative for every read and write in the app. (Avalanche and Arbitrum are temporarily disabled — see the note below.)"
    >
      <P>
        When a connected wallet is on a different chain, the console surfaces a mismatch prompt
        before any transaction is sent. Reads always use the selected network's RPC.
      </P>
      <Table
        head={["Property", "QIE Testnet", "QIE Mainnet"]}
        rows={[
          ["Chain ID", "1983", "1990"],
          ["Native token", "QIE", "QIE"],
          ["RPC", "rpc1testnet.qie.digital", "rpc1mainnet.qie.digital"],
          ["Explorer", "testnet.qie.digital", "mainnet.qie.digital"],
        ]}
      />
      <Table
        head={["Property", "BOT Chain Testnet", "BOT Chain Mainnet"]}
        rows={[
          ["Chain ID", "968", "677"],
          ["Native token", "BOT", "BOT"],
          ["RPC", "rpc.bohr.life", "rpc.botchain.ai"],
          ["Explorer", "scan.bohr.life", "scan.botchain.ai"],
        ]}
      />
      <Table
        head={["Property", "Arc Testnet"]}
        rows={[
          ["Chain ID", "5042002"],
          ["Native token", "USDC"],
          ["RPC", "rpc.testnet.arc.network"],
          ["Explorer", "testnet.arcscan.app"],
        ]}
      />
      <P>Arc does not have a mainnet yet.</P>
      <Table
        head={["Property", "GOAT Network Testnet", "GOAT Network Mainnet"]}
        rows={[
          ["Chain ID", "48816", "2345"],
          ["Native token", "BTC", "BTC"],
          ["RPC", "rpc.testnet3.goat.network", "rpc.goat.network"],
          ["Explorer", "explorer.testnet3.goat.network", "explorer.goat.network"],
        ]}
      />
      <P>
        Add a network to a wallet manually with the values above, or let DevStation request the
        network switch for you when you connect.
      </P>
      <P>
        <strong>Avalanche and Arbitrum are temporarily disabled</strong> — commented out of the
        network switcher and Explorer dropdown, not deleted. Avalanche's official explorer
        (Snowtrace) runs on Routescan rather than Blockscout, and DevStation already has a working
        adapter for it (blocks, transactions, and addresses all work natively); Arbitrum runs a
        community Blockscout mirror. Both can be re-enabled in code without any new integration work
        — see <code>src/lib/chains.ts</code>'s <code>SUPPORTED_CHAINS</code> comment.
      </P>
      <P>
        <strong>X Layer</strong> is not currently available in DevStation. Its explorer (OKLink)
        requires a registered API key DevStation doesn't have yet, so support is temporarily
        disabled rather than shipped with a half-working experience — it'll return once a key is
        available.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
