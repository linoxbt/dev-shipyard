import { createFileRoute } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import {
  DocPage,
  H2,
  P,
  Bullets,
  Table,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/explorer")({
  head: () => ({ meta: [{ title: "Block Explorer · DevStation Docs" }] }),
  component: Explorer,
});

function Explorer() {
  return (
    <DocPage
      title="Block Explorer"
      icon={Compass}
      intro="A block explorer built into the console for every supported network. It reads the live chain, and every link names its network, so a link you share opens on the same chain for everyone."
    >
      <H2>Networks and links</H2>
      <Table
        head={["Network", "Path"]}
        rows={[
          ["QIE Mainnet", "/explorer/mainnet"],
          ["QIE Testnet", "/explorer/testnet"],
          ["BOT Chain Mainnet", "/explorer/bot-mainnet"],
          ["BOT Chain Testnet", "/explorer/bot-testnet"],
        ]}
      />
      <P>
        <ConsoleLink to="/explorer">/explorer</ConsoleLink> on its own opens your selected network.
        A badge in the header shows whether you are on a testnet or mainnet, and a dropdown switches
        network.
      </P>

      <H2>Home</H2>
      <Bullets
        items={[
          "Token price and market cap, average block time, total blocks and transactions, gas price and utilisation.",
          "Charts of daily transactions and price over 30 days.",
          "Live feeds of the latest blocks and transactions.",
          "One search box for an address, transaction hash or block number.",
        ]}
      />

      <H2>Pages</H2>
      <Table
        head={["Page", "Path", "Shows"]}
        rows={[
          [
            "Transaction",
            "/tx/<hash>",
            "Status, block and confirmations, from and to, transfers, value, fee, gas, EIP-1559 detail, nonce, logs, decoded input.",
          ],
          [
            "Block",
            "/block/<height>",
            "Miner, reward, gas, base fee, burnt fees, size, and its transactions.",
          ],
          [
            "Address",
            "/address/<address>",
            "Balance, counters, creator, and tabs for transactions, token transfers, tokens, internal transactions and logs.",
          ],
          ["Token", "/token/<address>", "Supply, holders ranked by share, transfers and decimals."],
          ["Lists", "/blocks, /txns, /tokens", "Latest blocks, transactions and tokens."],
          ["Stats", "/stats", "Network charts."],
          ["Verify", "/verify", "Publish a contract's source."],
        ]}
      />
      <P>
        Paths are relative to the network, for example <C>/explorer/mainnet/tx/0x…</C>.
      </P>

      <H2>Contracts</H2>
      <P>A verified contract&apos;s Contract tab gives the full developer view:</P>
      <Bullets
        items={[
          "Code: compiler and EVM version, optimisation, licence and source.",
          "Read Contract and Write Contract: call view functions, and send transactions with your wallet.",
          "ABI, ready to copy.",
          "Bytecode: deployed and creation bytecode, shown for unverified contracts too.",
        ]}
      />
      <P>
        An unverified contract links to the verification form. See{" "}
        <DocLink to="/docs/verification">Contract Verification</DocLink>.
      </P>
    </DocPage>
  );
}
