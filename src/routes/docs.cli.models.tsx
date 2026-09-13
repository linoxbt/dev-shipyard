import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { DocPage, H2, H3, P, Code, Callout, C, Table } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/models")({
  head: () => ({ meta: [{ title: "Models & Providers · DevStation CLI" }] }),
  component: CliModels,
});

function CliModels() {
  return (
    <DocPage
      title="Models & Providers"
      icon={KeyRound}
      intro="Set up a model once and every new terminal just works. Keys are kept in a file only you can read, and never in a config file you might commit."
    >
      <H2>Log in</H2>
      <Code code="devstation login" />
      <P>
        It asks which provider, then the key (hidden as you type), then the model. Or name the
        provider:
      </P>
      <Code
        code={`devstation login anthropic     # Claude, directly
devstation login openrouter    # one key for Claude, GPT, Gemini, DeepSeek and more
devstation login openai        # OpenAI, or any compatible server: Ollama, LM Studio, Groq, Together`}
      />
      <P>For scripts, the key can come from standard input:</P>
      <Code code={`echo "$OPENROUTER_API_KEY" | devstation login openrouter`} />
      <P>
        <C>devstation logout [provider]</C> removes stored keys. <C>devstation config</C> shows
        every value in use and where it came from.
      </P>

      <H2>Endpoints</H2>
      <Table
        head={["To use", "provider", "baseUrl", "Key"]}
        rows={[
          ["Anthropic", "anthropic", "default", "yes"],
          ["OpenRouter", "openrouter", "default", "yes"],
          ["OpenAI", "openai", "default (https://api.openai.com/v1)", "yes"],
          ["Ollama", "openai", "http://localhost:11434/v1", "none"],
          ["LM Studio", "openai", "http://localhost:1234/v1", "none"],
          ["Groq", "openai", "https://api.groq.com/openai/v1", "yes"],
          ["Together", "openai", "https://api.together.xyz/v1", "yes"],
          ["An Anthropic-compatible gateway", "anthropic", "the gateway's URL", "yes"],
        ]}
      />
      <P>
        <C>baseUrl</C> is everything up to, not including, <C>/chat/completions</C>. The{" "}
        <C>openai</C> provider always needs a model name, because every compatible server names them
        differently. For a local server, leave the key blank when asked.
      </P>

      <H2>Where settings live</H2>
      <Code
        language="text"
        code={`~/.devstation/config.json         provider, model, baseUrl        (global)
.devstation/config.json           the same, for one project       (overrides global)
~/.devstation/credentials.json    API keys                        (owner-only, mode 600)`}
      />
      <P>
        <C>config.json</C> never holds a key: it is the file people share and commit, so a key there
        would end up in git. An <C>apiKey</C> field in it is ignored with a warning. Keys go through{" "}
        <C>login</C> into the credentials file, which only you can read, and <C>doctor</C> warns if
        its permissions are ever loosened.
      </P>
      <Code
        language="json"
        code={`{
  "provider": "openai",
  "model": "llama3.3",
  "baseUrl": "http://localhost:11434/v1"
}`}
      />

      <H3>Change one setting</H3>
      <Code
        code={`devstation config set model anthropic/claude-opus-5
devstation config set provider openrouter
devstation config set baseUrl https://api.groq.com/openai/v1
devstation config set model qwen2.5-coder --project    # this workspace only
devstation config get model
devstation config unset baseUrl
devstation config path                                 # where the files are`}
      />
      <P>
        Inside a session, <C>/model &lt;name&gt;</C> switches the model for that session only.
      </P>

      <H2>Which value wins</H2>
      <Table
        head={["Setting", "First found wins"]}
        rows={[
          [
            "provider",
            "DEVSTATION_PROVIDER → project config → global config → inferred from whichever key is exported",
          ],
          [
            "model",
            "--model → DEVSTATION_MODEL → project config → global config → provider default",
          ],
          ["baseUrl", "DEVSTATION_BASE_URL → project config → global config → provider default"],
          ["key", "the exported variable for that provider → ~/.devstation/credentials.json"],
        ]}
      />
      <P>
        A provider you chose in a config file is never overridden by a key that happens to be
        exported for some other tool. With no settings files at all, <C>ANTHROPIC_API_KEY</C> is
        used first, then <C>OPENROUTER_API_KEY</C>.
      </P>

      <H2>On a server or in CI</H2>
      <P>Environment variables still work, and are what a server or CI job should use:</P>
      <Code
        code={`export ANTHROPIC_API_KEY=...
export OPENROUTER_API_KEY=...
export OPENAI_API_KEY=...`}
      />
      <Callout tone="warning">
        Treat a provider key like a password. Do not paste it into a project file, a chat, or an
        issue. If one leaks, revoke it at the provider and run <C>devstation login</C> again.
      </Callout>
    </DocPage>
  );
}
