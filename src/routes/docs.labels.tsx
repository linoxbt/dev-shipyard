import { createFileRoute } from "@tanstack/react-router";
import { Tags } from "lucide-react";
import { DocPage, H2, P, Table, Steps, Callout, ConsoleLink } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/labels")({
  head: () => ({ meta: [{ title: "Label Registry · DevStation Docs" }] }),
  component: Labels,
});

function Labels() {
  return (
    <DocPage
      title="Label Registry"
      icon={Tags}
      intro="Readable names for contracts, stored on chain in the ContractLabelRegistry, so the ecosystem reads like words instead of hex. Routebook and the rest of the console use them."
    >
      <H2>Where labels come from</H2>
      <Table
        head={["Source", "Meaning"]}
        rows={[
          [
            "Auto",
            "Added when you deploy through DevStation with auto-labelling on. Pre-approved.",
          ],
          ["Community", "Submitted by a user. Waits for approval."],
          ["Verified", "A community label that has been approved."],
        ]}
      />

      <H2>Submit a label</H2>
      <Steps
        steps={[
          {
            title: "Open the registry",
            body: (
              <P>
                Go to <ConsoleLink to="/routebook/labels">Label Registry</ConsoleLink> with a wallet
                connected.
              </P>
            ),
          },
          { title: "Enter the contract and a name", body: "Use the name people know it by." },
          {
            title: "Sign",
            body: "Submitting writes a transaction to the registry, so you need a little of the network's token for gas.",
          },
        ]}
      />
      <P>
        Labels you contribute are counted on your dashboard, and five of them earn the Labeler
        achievement.
      </P>

      <Callout>
        Auto-labelling of your own deployments can be switched off in{" "}
        <ConsoleLink to="/settings">Settings</ConsoleLink>.
      </Callout>
    </DocPage>
  );
}
