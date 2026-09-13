import { createFileRoute } from "@tanstack/react-router";
import { Code2 } from "lucide-react";
import {
  DocPage,
  H2,
  P,
  Bullets,
  Table,
  Callout,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/editor")({
  head: () => ({ meta: [{ title: "Contract Editor · DevStation Docs" }] }),
  component: Editor,
});

function Editor() {
  return (
    <DocPage
      title="Contract Editor"
      icon={Code2}
      intro="Write, compile and deploy Solidity without leaving the browser. The compiler is the real solc, running in a worker, so what compiles here compiles anywhere."
    >
      <H2>What you can do</H2>
      <Bullets
        items={[
          "Write or paste a contract, and choose the compiler version.",
          "See errors and warnings inline, at the line they refer to.",
          "Deploy the compiled contract to the selected network through your wallet.",
          "Call the deployed contract's functions from the interaction panel.",
          "Drive it from the built-in terminal.",
        ]}
      />
      <P>
        Open it from <ConsoleLink to="/launchkit/editor">Contract Editor</ConsoleLink> in the
        sidebar, from a template, or from any code block that{" "}
        <DocLink to="/docs/ai">Code with AI</DocLink> writes.
      </P>

      <H2>Imports</H2>
      <P>
        Imports such as <C>@openzeppelin/contracts/token/ERC20/ERC20.sol</C> are fetched and
        resolved before compiling, so common libraries work without installing anything.
      </P>

      <H2>Terminal commands</H2>
      <Table
        head={["Command", "What it does"]}
        rows={[
          ["compile", "Compile the open contract."],
          ["solc <version>", "Switch the compiler version."],
          ["ls", "List the files in the editor."],
          ["cat <file>", "Print a file."],
          ["clear", "Clear the terminal."],
          ["help", "List the commands."],
        ]}
      />

      <Callout tone="tip">
        To verify a contract that uses imports, the explorer needs a single flattened file. Compile
        it here first, then use the flattened source in the{" "}
        <DocLink to="/docs/verification">verification form</DocLink>.
      </Callout>
    </DocPage>
  );
}
