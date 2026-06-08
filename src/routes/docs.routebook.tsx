import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { DocPage, P, Bullets, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/routebook")({
  head: () => ({ meta: [{ title: "Inspect Transactions - DevStation Docs" }] }),
  component: Routebook,
});

function Routebook() {
  const { prev, next } = docNeighbors("/docs/routebook");
  return (
    <DocPage
      title="Inspect Transactions"
      icon={Search}
      intro="Routebook turns a raw QIE transaction into something you can read. Paste any transaction hash and it decodes the call into a tree of internal calls, decoded arguments, and emitted events."
    >
      <P>Onchain contract labels are applied where they exist, so addresses read as names.</P>
      <P>Use Routebook to:</P>
      <Bullets
        items={[
          "Understand exactly what a transaction did, step by step.",
          "See decoded events and parameters instead of raw hex.",
          "Resolve contract addresses to human-readable names from the Label Registry.",
          "Re-open recent inspections from the Overview.",
        ]}
      />
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
