import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Callout,
  Table,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/ai")({
  head: () => ({ meta: [{ title: "Code with AI · DevStation Docs" }] }),
  component: CodeWithAI,
});

function CodeWithAI() {
  return (
    <DocPage
      title="Code with AI"
      icon={Sparkles}
      intro="Code with AI writes, audits and deploys smart contracts. Chat drafts and reviews contracts with you; Agent builds and ships one on its own, stopping for your signature."
    >
      <H2>Chat</H2>
      <P>
        Describe a contract and the assistant writes it, or paste one and ask for a security review
        with findings graded by severity. Every code block has an{" "}
        <strong className="text-foreground">Open in Editor</strong> button that drops the source
        into the <DocLink to="/docs/editor">Contract Editor</DocLink>. Answers are tailored to the
        network you have selected.
      </P>

      <H2>Agent</H2>
      <P>
        Switch to the Agent tab and describe a contract. It runs the whole loop, reporting each
        step:
      </P>
      <Steps
        steps={[
          { title: "Generate", body: "Writes a complete contract from your request." },
          { title: "Compile", body: "Compiles it in the browser and reads the compiler output." },
          {
            title: "Fix",
            body: "If compilation fails, it rewrites the source and compiles again, up to five times.",
          },
          {
            title: "Deploy",
            body: "When the constructor needs arguments, a form appears pre-filled with sensible values for you to check. Your wallet shows the real cost before you sign.",
          },
          { title: "Record", body: "Records the deployment and links it in the explorer." },
        ]}
      />
      <Callout tone="warning">
        Agent deploys are real transactions on the selected network. Check the network in the
        sidebar before you start, and read what your wallet asks you to sign.
      </Callout>

      <H2>Providers and keys</H2>
      <P>
        Both modes, and the <DocLink to="/docs/coding-agent">Coding Agent</DocLink>, use the AI
        provider you choose. Open the AI settings panel on the{" "}
        <ConsoleLink to="/launchkit/ai">Code with AI</ConsoleLink> page, pick a provider and model,
        and add a key.
      </P>
      <Table
        head={["Provider", "Models"]}
        rows={[
          ["OpenRouter", "One key reaches every model below. The default."],
          ["Anthropic", "Claude Opus 5, Sonnet 5, Fable 5, Opus 4.8, Haiku 4.5"],
          ["OpenAI", "GPT-5.6 Sol, Terra and Luna, GPT-5.5, GPT-5.4 Mini"],
          ["DeepSeek", "V4 Pro, V4 Flash"],
          ["Others via OpenRouter", "Google Gemini 3.7 Flash, xAI Grok 4.6, Qwen3.8 Max"],
        ]}
      />
      <H3>How your key is kept</H3>
      <Bullets
        items={[
          "A key you add is stored in this browser only.",
          "Where the deployment offers a server-side key, requests can go through it instead and no key reaches the browser.",
          "The model list shows an indicative price per million tokens, so the cost is visible before you choose.",
        ]}
      />
    </DocPage>
  );
}
