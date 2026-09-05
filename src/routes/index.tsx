import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Rocket,
  Search,
  Compass,
  Sparkles,
  Tags,
  ShieldCheck,
  Terminal,
  ArrowRight,
  Sun,
  Moon,
  BookOpen,
  Github,
} from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { InstallButton } from "@/components/pwa/InstallButton";
import { useTheme } from "@/lib/theme";
import { useNetworkStatus } from "@/hooks/useChainData";
import { useCombinedDeployStats } from "@/hooks/useProjectRegistry";
import { DEFAULT_CHAIN } from "@/lib/chains";
import { formatGas } from "@/lib/format-gas";
import { withCommas } from "@/lib/explorer/format";
import { EXPLORER_CHAIN_FAMILIES } from "@/lib/explorer/network";
import { TEMPLATES } from "@/lib/data/templates";
import { cn } from "@/lib/utils";
import { HeroStage } from "@/components/landing/HeroStage";
import { ChainsBand } from "@/components/landing/ChainsBand";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { ImageReveal } from "@/components/landing/ImageReveal";
import { Reveal } from "@/components/landing/Reveal";
import { REVEAL_IMAGES } from "@/lib/landing-images";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DevStation: The AI Developer OS for QIE and Web3" },
      {
        name: "description",
        content:
          "The AI Developer OS for QIE and Web3. Describe what you want built and DevStation writes, tests, deploys and verifies the contracts, then generates the app.",
      },
    ],
  }),
  component: Landing,
});

const WORDS = ["Deploy.", "Debug.", "Analyze.", "Inspect."];
const WORD_MS = 600;

function Landing() {
  const [shown, setShown] = useState(0);
  const tagline = shown >= WORDS.length;
  useEffect(() => {
    if (shown >= WORDS.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), WORD_MS);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <Hero shown={shown} tagline={tagline} />
      <PipelineBand />
      <StatsBand />
      <ChainsBand />
      <ImageReveal
        eyebrow="Write"
        title="Describe it. Get real Solidity back."
        body="Plain language in, audited contracts out: compiled in the browser against the chain you are targeting, with the errors surfaced before anything is signed."
        src={REVEAL_IMAGES.write}
        side="right"
        footnote="solc 0.8.24 · evmVersion shanghai"
      />
      <Features />
      <ImageReveal
        eyebrow="Deploy"
        title="Onto QIE. Onto BOT Chain."
        body="The same contract, the same flow, whichever you ship to. Gas is paid in that chain's own token and the deployment is written to that chain's own registry."
        src={REVEAL_IMAGES.deploy}
        side="left"
        footnote="QIE 1990 · 1983  ·  BOT Chain 677 · 968"
      />
      <TemplatesShowcase />
      <ImageReveal
        eyebrow="Inspect"
        title="Read it back like English."
        body="Every transaction decoded into a call tree (internal calls, arguments, transfers, events, revert reasons), with contracts carrying the names you gave them onchain."
        src={REVEAL_IMAGES.inspect}
        side="right"
        footnote="Routebook · Explorer · Label Registry"
      />
      <Steps />
      <CtaBand />
      <Footer />
    </div>
  );
}

/* ─────────────── Nav ─────────────── */

function LandingNav() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 py-3 px-5 sm:px-8 lg:px-12">
        <Link to="/" className="flex items-center gap-2" aria-label="DevStation">
          <LogoMark className="h-7 w-7" />
          <span className="font-mono text-sm font-bold tracking-tight">
            Dev<span className="text-primary">Station</span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-5 font-mono text-xs text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#templates" className="hover:text-foreground">
            Templates
          </a>
          <Link
            to="/explorer/$network"
            params={{ network: "mainnet" }}
            className="hover:text-foreground"
          >
            Explorer
          </Link>
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <InstallButton className="hidden sm:inline-flex" />
          <button
            onClick={toggle}
            className="rounded border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary"
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            to="/overview"
            className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Launch Console
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ─────────────── Hero ─────────────── */

function Hero({ shown, tagline }: { shown: number; tagline: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-primary) 1px, transparent 1px), linear-gradient(90deg, var(--color-primary) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--color-primary)" }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12 lg:py-28 px-5 sm:px-8 lg:px-12">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-[11px] text-meta">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            <span className="text-primary">devstation</span>
            <span>~ AI Developer OS</span>
          </div>

          <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-5xl font-bold leading-tight sm:text-7xl">
            {WORDS.map((w, i) => (
              <span key={w} className={i < shown ? "animate-fade-up" : "opacity-0"}>
                {w === "Deploy." ? (
                  <span className="text-primary">{w}</span>
                ) : w === "Inspect." ? (
                  <span className="text-info">{w}</span>
                ) : (
                  w
                )}
              </span>
            ))}
            {!tagline && <span className="terminal-cursor ml-1" />}
          </h1>

          <p
            className={cn(
              "mt-6 max-w-2xl font-mono text-base text-muted-foreground sm:text-lg",
              tagline ? "animate-fade-up" : "opacity-0",
            )}
          >
            The AI Developer OS for QIE and Web3. Describe what you want built. DevStation writes
            the contracts, tests them, deploys and verifies them onchain, and generates the app. No
            local toolchain. It runs on QIE and BOT Chain alike: same editor, same registries, same
            explorer, whichever you ship to.
          </p>

          <div
            className={cn(
              "mt-8 flex flex-wrap items-center gap-3",
              tagline ? "animate-fade-up" : "opacity-0",
            )}
          >
            <Link
              to="/overview"
              className="flex items-center gap-2 rounded bg-primary px-5 py-2.5 font-mono text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              <Rocket className="h-4 w-4" /> Launch Console
            </Link>
            <Link
              to="/docs"
              className="flex items-center gap-2 rounded border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:border-primary hover:text-primary"
            >
              <BookOpen className="h-4 w-4" /> Read the docs
            </Link>
          </div>
        </div>

        {/* The work itself, turning. Both chain marks ride the same rotation
            at the same size, so the dual-chain claim in the copy is something
            the page shows rather than only states. */}
        <HeroVisual className={cn(tagline ? "animate-fade-up" : "opacity-0")} />
      </div>
    </section>
  );
}

/* ─────────────── Pipeline ─────────────── */

/** The four steps, running, alternating the chain on every pass. It used to sit
 *  in the hero; the photograph took that slot, and this reads better with room
 *  around it anyway. */
function PipelineBand() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto max-w-6xl py-10 px-5 sm:px-8 lg:px-12">
        <HeroStage />
      </div>
    </section>
  );
}

/* ─────────────── Live stats ─────────────── */

function StatsBand() {
  // The app's default chain (QIE mainnet): read from DEFAULT_CHAIN rather
  // than hardcoded, so this stat can't drift from what users actually land on.
  const { data: net } = useNetworkStatus(DEFAULT_CHAIN.id);
  // Universal across Testnet + Mainnet.
  const stats = useCombinedDeployStats();
  const gas = formatGas(
    net && "gasPrice" in net ? (net as { gasPrice?: string }).gasPrice : undefined,
    net?.gasPriceGwei ?? 0,
  );
  const items = [
    { label: "Templates", value: TEMPLATES.length.toString() },
    {
      label: "Contracts Deployed",
      value: stats.totalDeployments != null ? withCommas(stats.totalDeployments) : "-",
    },
    { label: "Users", value: stats.onChain ? withCommas(stats.uniqueDeployers) : "-" },
    // Distinct chain families, not a raw count of testnet+mainnet entries
    // (which would double-count and read misleadingly high). This is a live
    // count, so the landing copy stays correct as networks are added.
    { label: "Networks", value: EXPLORER_CHAIN_FAMILIES.length.toString() },
    { label: "Gas", value: net?.status === "online" ? gas.text : "-" },
  ];
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-border sm:grid-cols-5 px-5 sm:px-8 lg:px-12">
        {items.map((s) => (
          <div key={s.label} className="px-4 py-6 text-center">
            <div className="font-mono text-2xl font-bold text-foreground">{s.value}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────── Features ─────────────── */

const FEATURES = [
  {
    icon: Rocket,
    title: "LaunchKit",
    body: "Deploy audited templates in seconds, or write your own contract in the in-browser editor with real compilation for the chain you target. No CLI, no setup.",
  },
  {
    icon: Search,
    title: "Routebook",
    body: "Decode any transaction on QIE or BOT Chain into a readable call tree: internal calls, decoded arguments, token transfers, events, and revert reasons.",
  },
  {
    icon: Compass,
    title: "Explorer",
    body: "A native, Etherscan-style block explorer for blocks, transactions, addresses, tokens and holders, across QIE and BOT Chain, testnet and mainnet.",
  },
  {
    icon: Sparkles,
    title: "Code with AI",
    body: "Describe a contract in plain language and get production-ready, audited Solidity back. Bring your own key, or use the built-in server proxy.",
  },
  {
    icon: ShieldCheck,
    title: "Onchain registries",
    body: "Every deployment is recorded in an onchain ProjectRegistry (one on QIE, one on BOT Chain), and contracts get human-readable names in the onchain Label Registry.",
  },
  {
    icon: Tags,
    title: "Contract labels",
    body: "Human-readable names for contracts across the app, stored onchain so the ecosystem reads like English, not hex.",
  },
];

function Features() {
  return (
    <section id="features" className="border-b border-border">
      <div className="mx-auto max-w-6xl py-16 px-5 sm:px-8 lg:px-12">
        <SectionHeading
          kicker="Everything in one console"
          title="The complete onchain developer workflow"
          subtitle="Write, deploy, inspect and explore: against live QIE and BOT Chain networks, with the records that matter kept onchain."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal
              key={f.title}
              delay={i * 70}
              className="rounded-lg border border-border bg-surface p-5 transition hover:border-primary/50"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded bg-primary/10 text-primary">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="font-mono text-sm font-bold text-foreground">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Templates showcase ─────────────── */

function TemplatesShowcase() {
  return (
    <section id="templates" className="border-b border-border bg-surface">
      <div className="mx-auto max-w-6xl py-16 px-5 sm:px-8 lg:px-12">
        <SectionHeading
          kicker="LaunchKit templates"
          title="Ship in 60 seconds"
          subtitle="Self-contained, audited contracts. Configure the constructor, deploy to QIE or BOT Chain, and get a verified onchain record."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.map((t) => (
            <Link
              key={t.id}
              to="/launchkit/templates/$id"
              params={{ id: t.id }}
              className="group rounded-lg border border-border bg-background p-4 transition hover:border-primary/50"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-foreground">{t.name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">
                {t.category}
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {t.description}
              </p>
            </Link>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            to="/launchkit/templates"
            className="inline-flex items-center gap-2 rounded border border-primary px-4 py-2 font-mono text-xs text-primary hover:bg-primary/10"
          >
            Browse all templates <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── How it works ─────────────── */

const STEPS = [
  {
    n: 1,
    title: "Connect",
    body: "Connect an existing wallet or generate one in-app, with a recovery phrase you keep, then pick a network: QIE or BOT Chain, testnet or mainnet.",
  },
  {
    n: 2,
    title: "Build",
    body: "Pick a template or write your contract in the editor. Compilation happens for you: no toolchain to install.",
  },
  {
    n: 3,
    title: "Deploy",
    body: "Sign the deployment with your wallet and watch it land, with the result linked straight into the explorer.",
  },
  {
    n: 4,
    title: "Inspect",
    body: "Open it in Routebook and the built-in explorer, and share a verified onchain record.",
  },
];

function Steps() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl py-16 px-5 sm:px-8 lg:px-12">
        <SectionHeading kicker="How it works" title="From idea to onchain in four steps" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal
              key={s.n}
              delay={i * 90}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-bold text-primary">
                {s.n}
              </div>
              <h3 className="mt-3 font-mono text-sm font-bold text-foreground">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────── CTA ─────────────── */

function CtaBand() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="mx-auto max-w-3xl py-16 text-center px-5 sm:px-8 lg:px-12">
        <h2 className="font-mono text-2xl font-bold text-foreground sm:text-3xl">
          Start building on QIE and BOT Chain
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          Free to use. You only pay network gas for what you deploy. No installs, no signup.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/overview"
            className="flex items-center gap-2 rounded bg-primary px-5 py-2.5 font-mono text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-4 w-4" /> Launch Console
          </Link>
          <Link
            to="/launchkit/deploy"
            className="flex items-center gap-2 rounded border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:border-primary hover:text-primary"
          >
            Deploy a contract
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Footer ─────────────── */

function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 py-10 sm:flex-row sm:items-center px-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-2">
          <LogoMark className="h-6 w-6" />
          <span className="font-mono text-sm font-bold">
            Dev<span className="text-primary">Station</span>
          </span>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground sm:ml-6">
          <Link to="/overview" className="hover:text-foreground">
            Console
          </Link>
          <Link
            to="/explorer/$network"
            params={{ network: "mainnet" }}
            className="hover:text-foreground"
          >
            Explorer
          </Link>
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <Link to="/docs/networks" className="hover:text-foreground">
            All networks
          </Link>
        </nav>
        <div className="flex items-center gap-3 sm:ml-auto">
          <a
            href="https://github.com/linoxbt/dev-shipyard"
            target="_blank"
            rel="noreferrer"
            className="text-meta hover:text-foreground"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <span className="font-mono text-[10px] text-meta">
            DevStation: The AI Developer OS for QIE and Web3
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────── shared ─────────────── */

function SectionHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-2xl">
      <div className="font-mono text-[11px] uppercase tracking-wider text-primary">{kicker}</div>
      <h2 className="mt-2 font-mono text-2xl font-bold text-foreground sm:text-3xl">{title}</h2>
      {subtitle && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
