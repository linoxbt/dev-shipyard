import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { DocPage, P, Callout, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/verification")({
  head: () => ({ meta: [{ title: "Contract Verification - DevStation Docs" }] }),
  component: Verification,
});

function Verification() {
  const { prev, next } = docNeighbors("/docs/verification");
  return (
    <DocPage
      title="Contract Verification"
      icon={ShieldCheck}
      intro="After a deploy, DevStation can submit your contract source to the QIE explorer for verification."
    >
      <P>
        It resolves the exact compiler build, sends the flattened source, and lets the explorer
        detect the constructor arguments. You can also verify an existing deployment from the
        Projects page.
      </P>
      <P>
        You can also verify any contract manually in the QIE Explorer: open the Verify Contract form
        (from the explorer header, or from any unverified contract page), paste your flattened
        source, choose the compiler and options, and publish.
      </P>
      <Callout tone="warning">
        Verification depends on the QIE explorer&apos;s verifier service. If the explorer cannot
        confirm a submission, the contract still works and is fully usable. The verification request
        is correct and will complete once the explorer service accepts it.
      </Callout>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
