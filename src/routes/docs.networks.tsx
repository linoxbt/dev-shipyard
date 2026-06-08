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
      intro="DevStation supports both QIE networks. The selected network is authoritative for every read and write in the app."
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
      <P>
        Add QIE to a wallet manually with the values above, or let DevStation request the network
        switch for you when you connect.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
