import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, H3, Table, PageNav } from "@/components/docs/primitives";
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
      intro="DevStation is built for QIE, and also supports BOT Chain. Pick a network from the selector and the whole console follows it: templates, the deploy path, the explorer, and analytics all switch to match. The selected network is authoritative for every read and write."
    >
      <P>
        When a connected wallet is on a different network, the console surfaces a mismatch prompt
        before any transaction is sent. Reads always use the selected network&apos;s endpoint.
      </P>

      <H3>Supported networks</H3>
      <P>
        Solidity contracts, compiled in-browser with solc, deployed with any EVM wallet. Both
        networks run Blockscout-compatible explorers, so blocks, transactions, addresses and source
        verification all work natively.
      </P>
      <Table
        head={["Network", "Chain ID", "Token", "Type"]}
        rows={[
          ["QIE", "1983 / 1990", "QIE", "Testnet / Mainnet"],
          ["BOT Chain", "968 / 677", "BOT", "Testnet / Mainnet"],
        ]}
      />
      <P>
        QIE Mainnet is the default: it&apos;s what the console opens on before you pick anything
        else.
      </P>

      <H3>Gas-free deploys</H3>
      <P>
        On QIE Mainnet and BOT Chain Mainnet, DevStation can top your own wallet up with just enough
        native token to cover a deploy, so you can ship a contract without holding gas first. Your
        wallet still signs and sends everything itself, so it stays the deployer of record. Testnets
        aren&apos;t sponsored: they each have a public faucet instead.
      </P>

      <P>
        Add a network to a wallet manually, or let DevStation request the switch when you connect.
        Endpoints (RPCs and explorers) are configurable: the defaults are each network&apos;s public
        infrastructure, overridable via environment variables.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
