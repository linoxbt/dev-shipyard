import { createFileRoute } from "@tanstack/react-router";
import { Code2 } from "lucide-react";
import { DocPage, P, Bullets, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/editor")({
  head: () => ({ meta: [{ title: "Contract Editor - DevStation Docs" }] }),
  component: Editor,
});

function Editor() {
  const { prev, next } = docNeighbors("/docs/editor");
  return (
    <DocPage
      title="Contract Editor"
      icon={Code2}
      intro="The Contract Editor compiles Solidity entirely in your browser using a real solc pipeline loaded in a Web Worker. There is nothing to install and no backend compile step."
    >
      <P>
        External imports such as OpenZeppelin are resolved from a CDN before compilation, so common
        libraries work out of the box.
      </P>
      <P>From the editor you can:</P>
      <Bullets
        items={[
          "Write or paste Solidity and compile against a chosen compiler version.",
          "Read compiler errors and warnings inline with source locations.",
          "Deploy the compiled contract straight to the selected QIE network.",
          "Open the deployed contract in the interaction panel to call its functions.",
          "Drive an interactive terminal with commands (compile, solc <version>, ls, cat, clear, help).",
        ]}
      />
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
