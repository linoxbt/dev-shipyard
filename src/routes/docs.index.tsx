import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bot,
  Code2,
  Compass,
  LayoutDashboard,
  Rocket,
  Search,
  Sparkles,
  Store,
  Terminal,
  ArrowRight,
} from "lucide-react";
import {
  DocPage,
  H2,
  P,
  CardGrid,
  FeatureCard,
  Table,
  C,
  DocLink,
} from "@/components/docs/primitives";
import { ROOT_DOMAIN } from "@/lib/site-hosts";

export const Route = createFileRoute("/docs/")({
  head: () => ({ meta: [{ title: "Introduction · DevStation Docs" }] }),
  component: Introduction,
});

function Introduction() {
  const root = ROOT_DOMAIN || "devstation.online";
  return (
    <DocPage
      title="DevStation documentation"
      intro="DevStation is the developer platform for QIE. Deploy audited contracts, write and compile Solidity in the browser, build and publish apps with an AI coding agent, sell your work on the Marketplace, and inspect everything on chain, without installing a toolchain. When you want the same agent on your own machine, the DevStation CLI brings it to your terminal."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/docs/quickstart"
          className="group rounded-xl border border-primary/40 bg-primary/5 p-5 transition hover:border-primary"
        >
          <Rocket className="h-5 w-5 text-primary" />
          <p className="mt-3 font-semibold text-foreground">Quickstart</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Connect a wallet and deploy your first contract in about a minute.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Start here <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
        <Link
          to="/docs/cli/install"
          className="group rounded-xl border border-border bg-surface p-5 transition hover:border-primary/50"
        >
          <Terminal className="h-5 w-5 text-primary" />
          <p className="mt-3 font-semibold text-foreground">Install the CLI</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The coding agent in your terminal. One command, no runtime to install first.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Set it up <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>

      <H2>Where everything lives</H2>
      <P>DevStation is one product served from three addresses:</P>
      <Table
        head={["Address", "What is there"]}
        rows={[
          [root, "The home page: what DevStation is, and the CLI installer."],
          [`console.${root}`, "The console: every tool, your dashboard and the Marketplace."],
          [`docs.${root}`, "This documentation."],
          [`<name>.${root}`, "Apps that builders have published from the Coding Agent."],
        ]}
      />
      <P>
        Old links keep working: a console page opened on the home address, such as{" "}
        <C>{root}/overview</C>, forwards to the same page on the console.
      </P>

      <H2>The console</H2>
      <P>Everything in the console works against the network you pick in the sidebar.</P>
      <CardGrid>
        <FeatureCard
          icon={Rocket}
          title="Deploy a contract"
          body="Pick a built-in template, fill in its constructor, and deploy it through your wallet."
          to="/docs/launchkit"
        />
        <FeatureCard
          icon={Code2}
          title="Contract Editor"
          body="Write Solidity with a real in-browser compiler, then deploy and interact with it."
          to="/docs/editor"
        />
        <FeatureCard
          icon={Sparkles}
          title="Code with AI"
          body="Draft and audit contracts in chat, or let the agent generate, compile, fix and deploy."
          to="/docs/ai"
        />
        <FeatureCard
          icon={Bot}
          title="Coding Agent"
          body="Build a working app from a description, or point the agent at a GitHub repository."
          to="/docs/coding-agent"
        />
        <FeatureCard
          icon={Store}
          title="Marketplace"
          body="Buy and sell templates, apps, agent skills and UI kits for QIE or QUSDC."
          to="/docs/marketplace"
        />
        <FeatureCard
          icon={LayoutDashboard}
          title="Builder Dashboard"
          body="Your contracts, apps, earnings, achievements and QIE ID, read from chain."
          to="/docs/dashboard"
        />
        <FeatureCard
          icon={Search}
          title="Routebook"
          body="Decode any transaction into calls, arguments, token movements and events."
          to="/docs/routebook"
        />
        <FeatureCard
          icon={Compass}
          title="Explorer"
          body="A block explorer for every supported network, with contract read, write and verify."
          to="/docs/explorer"
        />
      </CardGrid>

      <H2>How DevStation is built</H2>
      <P>
        What matters is kept on chain, so it cannot be edited behind your back. Deployments are
        recorded in the ProjectRegistry, contract names in the ContractLabelRegistry, and every
        listing, purchase, tip and payout in the Marketplace contract. Your dashboard, the
        leaderboard and the ecosystem numbers are all computed from those records, so a figure shown
        in DevStation is one anyone can check. See{" "}
        <DocLink to="/docs/registries">Contracts &amp; Registries</DocLink> for the addresses.
      </P>
      <P>
        Where networks genuinely differ, these docs say so.{" "}
        <DocLink to="/docs/networks">Networks</DocLink> lists what each one supports.
      </P>
    </DocPage>
  );
}
