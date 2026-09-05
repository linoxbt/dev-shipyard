import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, Steps, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";
import { useTerminology } from "@/lib/terminology";

export const Route = createFileRoute("/docs/quickstart")({
  head: () => ({ meta: [{ title: "Quickstart - DevStation Docs" }] }),
  component: Quickstart,
});

function Quickstart() {
  const { t } = useTerminology();
  const { prev, next } = docNeighbors("/docs/quickstart");
  return (
    <DocPage
      title="Quickstart"
      intro="Deploy your first contract in under a minute, on whichever network you choose."
    >
      <Steps
        steps={[
          {
            title: "Connect a wallet",
            body: "Open DevStation and connect an injected wallet, or generate a DevStation wallet from the sidebar: generated wallets show you a recovery phrase before you continue. Pick any testnet from the network selector; the whole console follows your choice.",
          },
          {
            title: "Get testnet funds for gas",
            body: "You need a small amount of the network\u2019s token to pay fees. Use the faucet / get-gas link in the wallet panel for the selected network.",
          },
          {
            title: "Pick a template",
            body: t(
              "Open LaunchKit and choose a template \u2014 an ERC-20 token, an NFT collection, staking, vesting, and more \u2014 then fill in the fields in the guided form.",
            ),
          },
          {
            title: "Deploy",
            body: "DevStation compiles the contract for you and sends the transaction through your wallet, then waits for it to confirm.",
          },
          {
            title: "Inspect and share",
            body: "From the success screen, open the deployment in Routebook or the built-in explorer, and download a ready-to-use .env file.",
          },
        ]}
      />
      <Callout>
        Everything in the quickstart works the same on mainnet. Switch networks from the selector at
        the bottom of the sidebar before you deploy.
      </Callout>
      <P>
        From here, read about the networks DevStation supports, or jump straight into LaunchKit and
        the contract editor.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
