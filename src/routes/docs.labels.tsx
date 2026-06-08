import { createFileRoute } from "@tanstack/react-router";
import { Tags } from "lucide-react";
import { DocPage, P, Table, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/labels")({
  head: () => ({ meta: [{ title: "Label Registry - DevStation Docs" }] }),
  component: LabelRegistry,
});

function LabelRegistry() {
  const { prev, next } = docNeighbors("/docs/labels");
  return (
    <DocPage
      title="Label Registry"
      icon={Tags}
      intro="The Label Registry gives contracts human-readable names so the ecosystem reads like English instead of hex. Labels are stored onchain in the ContractLabelRegistry and are visible across Routebook and the rest of the console."
    >
      <Table
        head={["Source", "Meaning"]}
        rows={[
          ["Auto", "Created automatically when you deploy through DevStation. Pre-approved."],
          ["Community", "Submitted by a user. Awaits owner approval before it is marked verified."],
          ["Verified", "A community label that has been approved."],
        ]}
      />
      <P>
        Anyone can submit a label for a contract from the Label Registry page. Submitting writes a
        transaction to the registry, so you need a connected wallet and a little QIE for gas.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
