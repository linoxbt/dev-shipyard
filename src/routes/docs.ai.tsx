import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { DocPage, P, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/ai")({
  head: () => ({ meta: [{ title: "Code with AI - DevStation Docs" }] }),
  component: CodeWithAI,
});

function CodeWithAI() {
  const { prev, next } = docNeighbors("/docs/ai");
  return (
    <DocPage
      title="Code with AI"
      icon={Sparkles}
      intro="Code with AI helps you draft and refine Solidity from a natural-language description. Ask for a contract, iterate on it, and move the result into the editor to compile and deploy."
    >
      <P>
        The assistant can run against a server-side proxy so your provider key never reaches the
        browser. When no key is configured, the console falls back to a direct client path. See
        Settings to configure the provider.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
