import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { DocPage, H2, P, Bullets, Steps, ConsoleLink, DocLink } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/routebook")({
  head: () => ({ meta: [{ title: "Inspect Transactions · DevStation Docs" }] }),
  component: Routebook,
});

function Routebook() {
  return (
    <DocPage
      title="Inspect Transactions"
      icon={Search}
      intro="Routebook turns a raw transaction into something you can read: a tree of the calls it made, with decoded arguments, token movements, events and the reason it failed if it did."
    >
      <H2>Decode a transaction</H2>
      <Steps
        steps={[
          {
            title: "Select the network",
            body: "Routebook reads the network selected in the sidebar.",
          },
          {
            title: "Paste the hash",
            body: (
              <P>
                Open <ConsoleLink to="/routebook">Inspect Tx</ConsoleLink> and paste a transaction
                hash: 66 characters starting with 0x. The overview has a decode box too.
              </P>
            ),
          },
          {
            title: "Read the result",
            body: "The call tree, decoded parameters, transfers and events appear. Addresses with a label are shown by name.",
          },
        ]}
      />

      <H2>What you see</H2>
      <Bullets
        items={[
          "The top-level call and every internal call it made, nested in order.",
          "Function names and arguments decoded, instead of raw calldata.",
          "Native and token transfers: who sent what to whom.",
          "Emitted events, with their parameters.",
          "The revert reason, when a transaction failed.",
          "Names from the Label Registry in place of addresses.",
        ]}
      />
      <P>
        Every deploy success screen links straight to Routebook. To name a contract you see here,
        add it to the <DocLink to="/docs/labels">Label Registry</DocLink>.
      </P>
    </DocPage>
  );
}
