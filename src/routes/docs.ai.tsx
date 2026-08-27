import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { DocPage, H2, P, Bullets, Steps, Callout, PageNav } from "@/components/docs/primitives";
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
      intro="Code with AI writes, audits, and deploys contracts for you \u2014 in the right language for the network you\u2019re on. It has two modes: a Chat that drafts and reviews contracts, and an autonomous Agent that builds and ships one end to end."
    >
      <H2>Chat mode</H2>
      <P>
        Describe what you want and the assistant writes production-grade Solidity, or paste an
        existing contract and ask for a security review (findings are graded by severity). Every
        generated code block has an Open in Editor button that drops the source straight into the
        Contract Editor to compile and deploy. The assistant tailors its language and idioms to the
        network you have selected.
      </P>

      <H2>Agent mode</H2>
      <P>
        Switch to the Agent tab and describe a contract. The agent then runs the whole build loop on
        its own, reporting each step inline:
      </P>
      <Steps
        steps={[
          { title: "Generate", body: "Writes a complete, secure contract from your request." },
          { title: "Compile", body: "Compiles in the browser and reads the solc output." },
          {
            title: "Auto-fix",
            body: "If compilation fails, it rewrites the source and recompiles, up to 5 attempts.",
          },
          {
            title: "Deploy",
            body: "Deploys with your connected wallet. When the constructor needs arguments, a form appears pre-filled with sensible values for you to review and confirm before signing.",
          },
          {
            title: "Record",
            body: "Saves the deployment to My Projects and links to the built-in explorer.",
          },
        ]}
      />

      <Callout tone="warning">
        Agent deploys are real, wallet-signed transactions on the network you have selected. A
        mainnet target shows a real-gas warning. You approve every transaction in your wallet, and
        the run is saved so it survives a page refresh.
      </Callout>

      <H2>Providers</H2>
      <P>
        Both modes run against your chosen AI provider. The assistant can use a server-side proxy so
        your provider key never reaches the browser, or a direct bring-your-own-key path stored only
        in your browser.
      </P>
      <Bullets
        items={[
          "OpenRouter (default) — one key reaches all 15 models below",
          "Anthropic: Claude Opus 5, Sonnet 5, Fable 5, Opus 4.8, Haiku 4.5",
          "OpenAI: GPT-5.6 Sol / Terra / Luna, GPT-5.5, GPT-5.4 Mini",
          "DeepSeek: V4 Pro, V4 Flash",
          "Google Gemini 3.7 Flash, xAI Grok 4.6, Qwen3.8 Max",
          "Or go direct to OpenAI / Anthropic with that vendor's own key",
        ]}
      />
      <P>
        Pick a provider, model, and key in Settings. The model dropdown is grouped by vendor and
        shows each model&apos;s indicative price per 1M tokens, so the cost tradeoff is visible
        before you pick.
      </P>

      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
