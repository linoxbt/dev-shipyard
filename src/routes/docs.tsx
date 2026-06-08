import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Rocket,
  Search,
  Code2,
  Sparkles,
  Tags,
  FolderGit2,
  Compass,
  Terminal,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { CodeBlock } from "@/components/shared/CodeBlock";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation - DevStation" },
      {
        name: "description",
        content:
          "The developer documentation for DevStation, the developer console for QIE Blockchain.",
      },
    ],
  }),
  component: DocsPage,
});

// Section ids drive both the in-page nav and the scroll-spy highlight.
const SECTIONS = [
  { id: "introduction", label: "Introduction" },
  { id: "quickstart", label: "Quickstart" },
  { id: "networks", label: "Networks" },
  { id: "launchkit", label: "LaunchKit" },
  { id: "editor", label: "Contract Editor" },
  { id: "ai", label: "Code with AI" },
  { id: "routebook", label: "Routebook" },
  { id: "labels", label: "Label Registry" },
  { id: "registries", label: "Onchain Registries" },
  { id: "verification", label: "Contract Verification" },
  { id: "wallets", label: "Wallets" },
  { id: "faq", label: "FAQ" },
];

function DocsPage() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  // Scroll-spy: highlight the section nearest the top of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
      <header className="mb-12 border-b border-border pb-10">
        <div className="mb-4 flex items-center gap-2 font-mono text-xs text-meta">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-primary">devstation</span>
          <span>~ documentation</span>
        </div>
        <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          DevStation Docs
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          DevStation is the developer console for QIE Blockchain. Deploy contracts from audited
          templates, write and compile Solidity in the browser, decode any transaction, and label
          contracts onchain. This guide covers everything from your first deployment to the onchain
          registries that power the app.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/launchkit/deploy"
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-4 w-4" /> Deploy a contract
          </Link>
          <a
            href="https://devstation.online"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-sm text-muted-foreground hover:border-primary hover:text-primary"
          >
            devstation.online <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <div className="flex gap-10">
        {/* In-page nav */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-6 space-y-0.5">
            <div className="px-2 pb-2 font-mono text-[10px] uppercase tracking-wider text-meta">
              On this page
            </div>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={
                  "block rounded px-2 py-1 font-mono text-xs transition " +
                  (active === s.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
                }
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <article className="min-w-0 flex-1 space-y-16 pb-24">
          <Introduction />
          <Quickstart />
          <Networks />
          <LaunchKit />
          <Editor />
          <CodeWithAI />
          <Routebook />
          <LabelRegistry />
          <Registries />
          <Verification />
          <Wallets />
          <Faq />
        </article>
      </div>
    </div>
  );
}

/* ─────────────────────────── Sections ─────────────────────────── */

function Introduction() {
  return (
    <Section id="introduction" title="Introduction">
      <P>
        DevStation brings the everyday work of a smart-contract developer into one console: writing,
        compiling, deploying, inspecting, and labeling contracts on QIE. Everything runs against the
        live QIE network, and the records that matter (your deployments and the contract label
        registry) live onchain, not in a private database.
      </P>
      <P>The console is organized into two products and a set of shared tools:</P>
      <CardGrid>
        <FeatureCard
          icon={Rocket}
          title="LaunchKit"
          body="Deploy audited contract templates, write your own Solidity in the in-browser editor, and generate contracts with AI."
          to="/launchkit/templates"
        />
        <FeatureCard
          icon={Search}
          title="Routebook"
          body="Decode any QIE transaction into a readable call tree with events, internal calls, and onchain contract labels."
          to="/routebook"
        />
        <FeatureCard
          icon={Compass}
          title="QIE Explorer"
          body="A built-in window into the QIE explorer for blocks, transactions, and addresses without leaving the console."
          to="/explorer"
        />
        <FeatureCard
          icon={FolderGit2}
          title="Projects"
          body="A per-wallet history of every contract you have deployed through DevStation, backed by the onchain ProjectRegistry."
          to="/launchkit/projects"
        />
      </CardGrid>
    </Section>
  );
}

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart">
      <P>Deploy your first contract on QIE Testnet in under a minute.</P>
      <Steps
        steps={[
          {
            title: "Connect a wallet",
            body: "Open DevStation and connect an injected wallet (such as MetaMask), or generate an in-app burner wallet from the sidebar. The console defaults to QIE Testnet.",
          },
          {
            title: "Get testnet QIE for gas",
            body: "You need a small amount of QIE to pay for gas. Use the get-gas link in the wallet panel to reach the QIE faucet or swap.",
          },
          {
            title: "Pick a template",
            body: "Open LaunchKit, choose a template such as SimpleERC20, and fill in the constructor fields in the guided form.",
          },
          {
            title: "Deploy",
            body: "DevStation compiles the contract in your browser, sends the creation transaction through your wallet, and waits for the receipt.",
          },
          {
            title: "Inspect and share",
            body: "From the success screen, open the deployment in Routebook or on the QIE explorer, and download a ready-to-use .env file.",
          },
        ]}
      />
      <Callout>
        Everything in the quickstart works the same on QIE Mainnet. Switch networks from the
        selector at the bottom of the sidebar before you deploy.
      </Callout>
    </Section>
  );
}

function Networks() {
  return (
    <Section id="networks" title="Networks">
      <P>
        DevStation supports both QIE networks. The selected network is authoritative for every read
        and write in the app. When a connected wallet is on a different chain, the console surfaces
        a mismatch prompt before any transaction is sent.
      </P>
      <Table
        head={["Property", "QIE Testnet", "QIE Mainnet"]}
        rows={[
          ["Chain ID", "1983", "1990"],
          ["Native token", "QIE", "QIE"],
          ["RPC", "rpc1testnet.qie.digital", "rpc1mainnet.qie.digital"],
          ["Explorer", "testnet.qie.digital", "mainnet.qie.digital"],
        ]}
      />
      <P>
        Add QIE to a wallet manually with the values above, or let DevStation request the network
        switch for you when you connect.
      </P>
    </Section>
  );
}

function LaunchKit() {
  return (
    <Section id="launchkit" title="LaunchKit">
      <P>
        LaunchKit is the deployment surface. It ships with a set of self-contained, audited
        templates that compile with no external dependencies, so a deploy is fast and predictable.
      </P>
      <Table
        head={["Template", "Category", "What it is"]}
        rows={[
          ["SimpleERC20", "Token", "A standard fungible token with mint and burn."],
          ["SimpleERC721", "NFT", "A standard NFT collection with metadata."],
          ["SoulboundNFT", "NFT", "A non-transferable, identity-bound NFT."],
          ["MultiSigWallet", "Governance", "An m-of-n multi-signature wallet."],
          ["TimelockController", "Governance", "Queue and execute calls after a delay."],
          ["TokenVesting", "DeFi", "Linear token vesting with a cliff."],
          ["SimpleStaking", "DeFi", "Stake a token and earn rewards."],
          ["PaymentSplitter", "Utility", "Split incoming funds among payees."],
        ]}
      />
      <H3>The deploy flow</H3>
      <P>
        Selecting a template opens a guided form generated from its constructor. DevStation
        validates and encodes the arguments, compiles the source in a browser worker, and sends the
        creation transaction through your wallet. On success you get the contract address, the
        transaction hash, the block, a downloadable .env file, and one-click links into Routebook
        and the QIE explorer.
      </P>
      <Callout>
        You can also submit your own template to the community catalog from the Templates page. It
        becomes available to deploy like any built-in.
      </Callout>
    </Section>
  );
}

function Editor() {
  return (
    <Section id="editor" title="Contract Editor">
      <P>
        The Contract Editor compiles Solidity entirely in your browser using a real solc pipeline
        loaded in a Web Worker. There is nothing to install and no backend compile step. External
        imports such as OpenZeppelin are resolved from a CDN before compilation.
      </P>
      <P>From the editor you can:</P>
      <Bullets
        items={[
          "Write or paste Solidity and compile against a chosen compiler version.",
          "Read compiler errors and warnings inline with source locations.",
          "Deploy the compiled contract straight to the selected QIE network.",
          "Open the deployed contract in the interaction panel to call its functions.",
        ]}
      />
    </Section>
  );
}

function CodeWithAI() {
  return (
    <Section id="ai" title="Code with AI" icon={Sparkles}>
      <P>
        Code with AI helps you draft and refine Solidity from a natural-language description. Ask
        for a contract, iterate on it, and move the result into the editor to compile and deploy.
      </P>
      <P>
        The assistant can run against a server-side proxy so your provider key never reaches the
        browser. When no key is configured, the console falls back to a direct client path. See
        Settings to configure the provider.
      </P>
    </Section>
  );
}

function Routebook() {
  return (
    <Section id="routebook" title="Routebook" icon={Search}>
      <P>
        Routebook turns a raw QIE transaction into something you can read. Paste any transaction
        hash and it decodes the call into a tree of internal calls, decoded function arguments, and
        emitted events, with onchain contract labels applied where they exist.
      </P>
      <P>Use Routebook to:</P>
      <Bullets
        items={[
          "Understand exactly what a transaction did, step by step.",
          "See decoded events and parameters instead of raw hex.",
          "Resolve contract addresses to human-readable names from the Label Registry.",
          "Re-open recent inspections from the Overview.",
        ]}
      />
    </Section>
  );
}

function LabelRegistry() {
  return (
    <Section id="labels" title="Label Registry" icon={Tags}>
      <P>
        The Label Registry gives contracts human-readable names so the ecosystem reads like English
        instead of hex. Labels are stored onchain in the ContractLabelRegistry and are visible
        across Routebook and the rest of the console.
      </P>
      <Table
        head={["Source", "Meaning"]}
        rows={[
          ["Auto", "Created automatically when you deploy through DevStation. Pre-approved."],
          ["Community", "Submitted by a user. Awaits owner approval before it is marked verified."],
          ["Verified", "A community label that has been approved."],
        ]}
      />
      <P>
        Anyone can submit a label for a contract from the Label Registry page. Submitting writes a
        transaction to the registry, so you need a connected wallet and a little QIE for gas.
      </P>
    </Section>
  );
}

function Registries() {
  return (
    <Section id="registries" title="Onchain Registries" icon={ShieldCheck}>
      <P>
        DevStation keeps the records that matter onchain. Two registry contracts back the app, so
        your deployment history and contract labels are auditable and portable rather than locked in
        a private database.
      </P>
      <H3>ProjectRegistry</H3>
      <P>
        Records every contract deployed through DevStation against the deploying wallet, and keeps a
        global counter of total deployments. The Projects page reads your deployments back from it,
        scoped to your connected wallet. The Overview reads the global counter for the total
        contracts and total users stats.
      </P>
      <CodeBlock
        language="solidity"
        showLineNumbers={false}
        code={`function recordDeployment(
  address contractAddress,
  string calldata templateId,
  string calldata projectName,
  string calldata network,
  string calldata txHash
) external;

function getDeployments(address deployer)
  external view returns (Deployment[] memory);

uint256 public totalDeployments;`}
      />
      <H3>ContractLabelRegistry</H3>
      <P>
        Stores human-readable labels for contracts, with a source (auto, community, or verified) and
        the submitter. Routebook and the Label Registry page read from it.
      </P>
      <Callout>
        Registry writes use an explicit gas limit. QIE&apos;s gas estimator can under-report the gas
        a storage-writing call needs, so DevStation pins a safe limit to keep these transactions
        from running out of gas. At QIE&apos;s gas price this costs a negligible fraction of a QIE.
      </Callout>
    </Section>
  );
}

function Verification() {
  return (
    <Section id="verification" title="Contract Verification" icon={ShieldCheck}>
      <P>
        After a deploy, DevStation can submit your contract source to the QIE explorer for
        verification. It resolves the exact compiler build, sends the flattened source, and lets the
        explorer detect the constructor arguments. You can also verify an existing deployment from
        the Projects page.
      </P>
      <Callout tone="warning">
        Verification depends on the QIE explorer&apos;s verifier service. If the explorer cannot
        confirm a submission, the contract still works and is fully usable. The verification request
        is correct and will complete once the explorer service accepts it.
      </Callout>
    </Section>
  );
}

function Wallets() {
  return (
    <Section id="wallets" title="Wallets">
      <P>DevStation works with two kinds of wallet:</P>
      <Bullets
        items={[
          "Injected wallets such as MetaMask, connected through the standard provider.",
          "An in-app burner wallet generated and held locally, useful for quick testing.",
        ]}
      />
      <P>
        Either way, your connection survives page refreshes. It is cleared only when you disconnect,
        clear your browser data, or close the browser. The selected network, not the wallet&apos;s
        current chain, drives reads across the app; write flows prompt you to switch if the two do
        not match.
      </P>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" title="FAQ">
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
    </Section>
  );
}

/* ─────────────────────────── Primitives ─────────────────────────── */

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-4 flex items-center gap-2 font-mono text-2xl font-bold text-foreground">
        {Icon && <Icon className="h-5 w-5 text-primary" />}
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-mono text-base font-semibold text-foreground">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 rounded border border-border bg-surface p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
            {i + 1}
          </span>
          <div>
            <div className="font-mono text-sm font-semibold text-foreground">{s.title}</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded border border-border bg-surface p-4 transition hover:border-primary/50"
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-semibold text-foreground">{title}</span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </Link>
  );
}

function Callout({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  const accent = tone === "warning" ? "border-warning/40 bg-warning/5" : "border-info/30 bg-info/5";
  return (
    <div className={`rounded border ${accent} p-3 text-sm leading-relaxed text-muted-foreground`}>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-meta"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    "px-3 py-2 align-top " +
                    (j === 0
                      ? "font-mono text-xs text-foreground"
                      : "text-xs text-muted-foreground")
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-border pb-4 last:border-0">
      <p className="font-mono text-sm font-semibold text-foreground">{q}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</p>
    </div>
  );
}
