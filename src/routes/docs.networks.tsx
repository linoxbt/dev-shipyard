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
      intro="DevStation spans several networks across different virtual machines. Pick one from the selector and the whole console follows it — the editor's language, the templates, the deploy path, the explorer, and analytics all switch to match. The selected network is authoritative for every read and write."
    >
      <P>
        When a connected wallet is on a different network, the console surfaces a mismatch prompt
        before any transaction is sent. Reads always use the selected network&apos;s endpoint.
      </P>

      <H3>EVM networks</H3>
      <P>
        Solidity contracts, compiled in-browser with solc, deployed with any EVM wallet. Explorers
        are Blockscout-compatible, so blocks, transactions, addresses and verification all work
        natively.
      </P>
      <Table
        head={["Network", "Chain ID", "Token", "Type"]}
        rows={[
          ["QIE", "1983 / 1990", "QIE", "Testnet / Mainnet"],
          ["BOT Chain", "968 / 677", "BOT", "Testnet / Mainnet"],
          ["Arc", "5042002", "USDC", "Testnet"],
          ["GOAT Network", "48816 / 2345", "BTC", "Testnet / Mainnet"],
        ]}
      />
      <P>Arc has no mainnet yet.</P>

      <H3>Solana</H3>
      <P>
        Rust / Anchor programs and SPL tokens. Wallets are the in-app DevStation wallet (with a
        recovery phrase) or a browser wallet like Phantom. The explorer reads the Solana RPC
        directly.
      </P>
      <Table
        head={["Network", "Cluster", "Token"]}
        rows={[
          ["Solana Devnet", "devnet", "SOL"],
          ["Solana Mainnet", "mainnet-beta", "SOL"],
        ]}
      />

      <H3>Stacks</H3>
      <P>
        Clarity contracts on the Bitcoin L2, with a post-condition coverage auditor built into the
        editor. Sign with a generated DevStation wallet or Leather / Xverse.
      </P>
      <Table
        head={["Network", "Token"]}
        rows={[
          ["Stacks Testnet", "STX"],
          ["Stacks Mainnet", "STX"],
        ]}
      />

      <P>
        Add a network to a wallet manually, or let DevStation request the switch when you connect.
        Endpoints (RPCs and explorers) are configurable — the defaults are each network&apos;s
        public infrastructure, overridable via environment variables.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
