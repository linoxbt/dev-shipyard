import { createFileRoute } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import {
  DocPage,
  H2,
  P,
  Steps,
  Callout,
  ConsoleLink,
  DocLink,
  Code,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/quickstart")({
  head: () => ({ meta: [{ title: "Quickstart · DevStation Docs" }] }),
  component: Quickstart,
});

function Quickstart() {
  return (
    <DocPage
      title="Quickstart"
      icon={Rocket}
      intro="Deploy your first contract from the browser, then take the same work further with the Coding Agent or the CLI."
    >
      <H2>Deploy a contract</H2>
      <Steps
        steps={[
          {
            title: "Open the console and pick a network",
            body: (
              <P>
                Open the <ConsoleLink to="/overview">console</ConsoleLink>. The network selector at
                the bottom of the sidebar decides where everything reads and writes. It starts on
                QIE Mainnet; choose QIE Testnet if you want to try things for free first.
              </P>
            ),
          },
          {
            title: "Connect a wallet",
            body: (
              <P>
                Use the wallet panel at the top of the sidebar to connect a browser wallet, or
                create a DevStation wallet on the spot. A generated wallet shows its recovery phrase
                before you can use it: write it down. See{" "}
                <DocLink to="/docs/wallets">Wallets</DocLink>.
              </P>
            ),
          },
          {
            title: "Get gas",
            body: (
              <P>
                Testnets have a public faucet, linked from the wallet panel. On QIE Mainnet and BOT
                Chain Mainnet DevStation can top your wallet up with just enough to cover a deploy.
              </P>
            ),
          },
          {
            title: "Choose a template",
            body: (
              <P>
                Open <ConsoleLink to="/launchkit/deploy">Deploy</ConsoleLink> and pick a template,
                such as an ERC-20 token or an NFT collection. The form is generated from its
                constructor, and every field is checked before anything is sent.
              </P>
            ),
          },
          {
            title: "Deploy and confirm",
            body: (
              <P>
                DevStation compiles the contract, asks your wallet to sign the creation transaction,
                and waits for it to confirm. The deployment is recorded in the onchain
                ProjectRegistry against your wallet.
              </P>
            ),
          },
          {
            title: "Inspect it",
            body: (
              <P>
                From the success screen, open the contract in the explorer, decode the transaction
                in Routebook, verify the source, or download a ready-made <code>.env</code> file. It
                also appears on your <ConsoleLink to="/activity">dashboard</ConsoleLink>.
              </P>
            ),
          },
        ]}
      />

      <H2>Next steps</H2>
      <Steps
        steps={[
          {
            title: "Write your own contract",
            body: (
              <P>
                The <DocLink to="/docs/editor">Contract Editor</DocLink> compiles Solidity in the
                browser, and <DocLink to="/docs/ai">Code with AI</DocLink> can draft it for you.
              </P>
            ),
          },
          {
            title: "Build an app around it",
            body: (
              <P>
                Describe a front end to the <DocLink to="/docs/coding-agent">Coding Agent</DocLink>,
                watch it run in the preview, and <DocLink to="/docs/apps">publish it</DocLink> to
                its own address.
              </P>
            ),
          },
          {
            title: "Sell what you made",
            body: (
              <P>
                List a template, app, skill or UI kit on the{" "}
                <DocLink to="/docs/selling">Marketplace</DocLink>. You keep 95% of every sale.
              </P>
            ),
          },
          {
            title: "Work from your terminal",
            body: (
              <>
                <P>The DevStation CLI runs the same agent against a project on your machine:</P>
                <Code code={`npm install -g @devstationlabs/cli\ndevstation login\ndevstation`} />
                <P>
                  The <DocLink to="/docs/cli/install">CLI guide</DocLink> covers everything else.
                </P>
              </>
            ),
          },
        ]}
      />

      <Callout tone="tip">
        Everything above works the same on mainnet as on testnet. Switch networks in the sidebar
        before you deploy; transactions always go to the network you have selected, and your wallet
        is asked to switch if it is on a different one.
      </Callout>
    </DocPage>
  );
}
