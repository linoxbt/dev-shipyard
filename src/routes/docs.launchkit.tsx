import { createFileRoute } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Table,
  Steps,
  Bullets,
  Callout,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/launchkit")({
  head: () => ({ meta: [{ title: "Deploy a Contract · DevStation Docs" }] }),
  component: LaunchKit,
});

function LaunchKit() {
  return (
    <DocPage
      title="Deploy a Contract"
      icon={Rocket}
      intro="LaunchKit ships self-contained Solidity templates that compile with no external imports, so a deploy is fast and predictable. Pick one, fill in its constructor, and your wallet sends it."
    >
      <H2>Built-in templates</H2>
      <Table
        head={["Contract", "Category", "What it is"]}
        rows={[
          [
            "SimpleERC20",
            "Token",
            "A fungible token with a fixed initial supply minted to an owner.",
          ],
          ["SimpleERC721", "NFT", "An NFT collection with a base metadata URI."],
          ["SoulboundNFT", "NFT", "A non-transferable NFT bound to the wallet it is minted to."],
          ["SimpleStaking", "DeFi", "Stake a token and earn rewards at a rate per block."],
          [
            "MultiSigWallet",
            "Governance",
            "An m-of-n wallet: transactions need a set number of owners.",
          ],
          [
            "TimelockController",
            "Governance",
            "Queue calls and execute them after a minimum delay.",
          ],
          ["PaymentSplitter", "Utility", "Split incoming funds between payees by share."],
          ["MembershipPass", "Utility", "A time-limited membership NFT with a set duration."],
          ["ReputationRegistry", "Utility", "Record and read reputation scores for addresses."],
          ["QieIdGatedAllowlist", "Utility", "Claims limited to wallets that hold a QIE ID."],
        ]}
      />
      <P>
        Every built-in template is also listed in the{" "}
        <DocLink to="/docs/marketplace">Marketplace</DocLink> as an official listing, next to
        templates other builders sell. Two official templates, Stablecoin Invoices and Token
        Vesting, are paid listings: their files unlock when you buy them.
      </P>

      <H2>The deploy flow</H2>
      <Steps
        steps={[
          {
            title: "Select a template",
            body: (
              <P>
                Open <ConsoleLink to="/launchkit/deploy">Deploy</ConsoleLink> and search or browse
                the templates for the selected network.
              </P>
            ),
          },
          {
            title: "Configure it",
            body: (
              <P>
                The form is generated from the constructor. Addresses, numbers and arrays are
                validated as you type, and the right column shows what will be deployed and to which
                network.
              </P>
            ),
          },
          {
            title: "Deploy",
            body: (
              <P>
                DevStation compiles the source in a browser worker, encodes the arguments, and asks
                your wallet to sign. It then waits for the transaction to confirm and records the
                deployment in the ProjectRegistry.
              </P>
            ),
          },
        ]}
      />

      <H2>After a deploy</H2>
      <Bullets
        items={[
          "The contract address, transaction hash and block, each linked to the explorer.",
          <>
            A downloadable <C>.env</C> with the address and network, ready for a front end.
          </>,
          <>
            One click to decode the transaction in <DocLink to="/docs/routebook">Routebook</DocLink>
            .
          </>,
          <>
            <DocLink to="/docs/verification">Source verification</DocLink> on the network explorer.
          </>,
          "An automatic label in the Label Registry, if that is switched on in Settings.",
        ]}
      />

      <H3>Where your deployments show up</H3>
      <P>
        On your <ConsoleLink to="/activity">dashboard</ConsoleLink>, grouped by network, and in My
        Projects. A deploy made in another browser appears too, because the list is read from the
        registry rather than from local storage. A deployment that was not recorded, for example
        because the registry transaction was rejected, can be registered later from My Projects.
      </P>

      <Callout tone="tip">
        Want to change a template before deploying? Open it in the{" "}
        <DocLink to="/docs/editor">Contract Editor</DocLink>, edit the source, and deploy from
        there.
      </Callout>
    </DocPage>
  );
}
