import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Rocket, Search, Terminal } from "lucide-react";

// The four action words reveal one at a time, then the tagline fades in.
const WORDS = ["Deploy.", "Debug.", "Analyze.", "Inspect."];
const WORD_MS = 650;

export function HomeHero() {
  const [shown, setShown] = useState(0);
  const taglineVisible = shown >= WORDS.length;

  useEffect(() => {
    if (shown >= WORDS.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), WORD_MS);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <section className="relative overflow-hidden border-b border-border bg-surface">
      {/* Subtle terminal grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-primary) 1px, transparent 1px), linear-gradient(90deg, var(--color-primary) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--color-primary)" }}
      />

      <div className="relative mx-auto max-w-5xl px-6 py-16 sm:py-20">
        {/* Prompt line */}
        <div className="mb-6 flex items-center gap-2 font-mono text-xs text-meta">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-primary">devstation</span>
          <span>~ QIE Builder Console</span>
        </div>

        {/* Action words, revealed one at a time */}
        <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-4xl font-bold leading-tight text-foreground sm:text-6xl">
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
          {!taglineVisible && <span className="terminal-cursor ml-1" />}
        </h1>

        {/* Tagline fades in after the words */}
        <p
          className={
            "mt-6 max-w-xl font-mono text-base text-muted-foreground sm:text-lg " +
            (taglineVisible ? "animate-fade-up" : "opacity-0")
          }
        >
          The developer console for QIE Blockchain.
        </p>

        {/* CTAs */}
        <div
          className={
            "mt-8 flex flex-wrap items-center gap-3 " +
            (taglineVisible ? "animate-fade-up" : "opacity-0")
          }
        >
          <Link
            to="/launchkit/templates"
            className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-4 w-4" /> Deploy a contract
          </Link>
          <Link
            to="/routebook"
            className="flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-sm text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Search className="h-4 w-4" /> Inspect a transaction
          </Link>
        </div>
      </div>
    </section>
  );
}
