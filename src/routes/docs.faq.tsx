import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { DocPage, FaqItem, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/faq")({
  head: () => ({ meta: [{ title: "FAQ - DevStation Docs" }] }),
  component: Faq,
});

function Faq() {
  const { prev } = docNeighbors("/docs/faq");
  return (
    <DocPage title="FAQ" intro="Common questions about using DevStation.">
      <FaqItem
        q="Do I need to install anything?"
        a="No. Compilation runs in your browser and deployment goes through your wallet. There is no CLI or local toolchain to set up."
      />
      <FaqItem
        q="Where are my projects stored?"
        a="Deployments you make through DevStation are recorded in the onchain ProjectRegistry against your wallet, and mirrored locally for instant display. The Projects page shows only the connected wallet's deployments."
      />
      <FaqItem
        q="How are total users and total contracts counted?"
        a="Total contracts is the ProjectRegistry's onchain counter. Total users is the number of distinct wallets that have recorded a deployment, derived from the registry's transaction history."
      />
      <FaqItem
        q="Is DevStation free?"
        a="The console is free to use. You only pay QIE network gas for the transactions you send, such as deployments and label submissions."
      />
      <div className="mt-8 rounded border border-border bg-surface p-5">
        <p className="font-mono text-sm text-foreground">Still have a question?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          See the official QIE documentation for network-level details.
        </p>
        <a
          href="https://docs.qie.digital"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
        >
          Official QIE Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <PageNav prev={prev} />
    </DocPage>
  );
}
