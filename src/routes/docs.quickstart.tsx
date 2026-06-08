import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, Steps, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/quickstart")({
  head: () => ({ meta: [{ title: "Quickstart - DevStation Docs" }] }),
  component: Quickstart,
});

function Quickstart() {
  const { prev, next } = docNeighbors("/docs/quickstart");
  return (
    <DocPage
      title="Quickstart"
      intro="Deploy your first contract on QIE Testnet in under a minute."
    >
      <Steps
        steps={[
          {
            title: "Connect a wallet",
            body: "Open DevStation and connect an injected wallet (such as MetaMask), or generate an in-app burner wallet from the sidebar. The console defaults to QIE Testnet.",
          },
          {
            title: "Get testnet QIE for gas",
            body: "You need a small amount of QIE to pay for gas. Use the get-gas link in the wallet panel to reach the QIE faucet or swap.",
          },
          {
            title: "Pick a template",
            body: "Open LaunchKit, choose a template such as SimpleERC20, and fill in the constructor fields in the guided form.",
          },
          {
            title: "Deploy",
            body: "DevStation compiles the contract in your browser, sends the creation transaction through your wallet, and waits for the receipt.",
          },
          {
            title: "Inspect and share",
            body: "From the success screen, open the deployment in Routebook or on the QIE explorer, and download a ready-to-use .env file.",
          },
        ]}
      />
      <Callout>
        Everything in the quickstart works the same on QIE Mainnet. Switch networks from the
        selector at the bottom of the sidebar before you deploy.
      </Callout>
      <P>
        From here, read about the networks DevStation supports, or jump straight into LaunchKit and
        the contract editor.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
