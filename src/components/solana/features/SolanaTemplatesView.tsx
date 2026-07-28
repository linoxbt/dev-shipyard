// Solana variant of the Templates page — rendered by /launchkit/templates when
// the active chain family is Solana (see src/routes/launchkit.templates.index.tsx).

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Coins, Image as ImageIcon, Cpu, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ChainLogo } from "@/lib/chain-logos";
import {
  SOLANA_TEMPLATES,
  SOLANA_CATEGORIES,
  categoryColor,
  type SolanaTemplateKind,
} from "@/lib/solana/templates";

const KIND_ICON: Record<SolanaTemplateKind, typeof Coins> = {
  token: Coins,
  nft: ImageIcon,
  program: Cpu,
};

type CatFilter = "All" | (typeof SOLANA_CATEGORIES)[number];

export function SolanaTemplatesView() {
  const [cat, setCat] = useState<CatFilter>("All");
  const list = cat === "All" ? SOLANA_TEMPLATES : SOLANA_TEMPLATES.filter((t) => t.category === cat);

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Templates"]}
        title="Template Gallery"
        subtitle="Deploy SPL tokens & NFTs in-browser on devnet, or open a program in the editor."
        action={<ChainLogo family="Solana" size={24} />}
      />

      <div className="p-4 lg:p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {(["All", ...SOLANA_CATEGORIES] as CatFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded border px-2.5 py-1 font-mono text-xs transition ${
                cat === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-meta hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => {
            const Icon = KIND_ICON[t.kind];
            const isProgram = t.kind === "program";
            return (
              <Link
                key={t.id}
                to={isProgram ? "/launchkit/editor" : "/launchkit/deploy"}
                search={{ template: t.id }}
                className="group flex flex-col rounded border border-border bg-surface p-4 transition hover:border-primary/50"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm font-bold text-foreground">{t.name}</span>
                  <span
                    className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] ${categoryColor(t.category)}`}
                  >
                    {t.category}
                  </span>
                </div>
                <p className="flex-1 font-mono text-xs leading-relaxed text-muted-foreground">
                  {t.description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-primary opacity-0 transition group-hover:opacity-100">
                  {isProgram ? "Open in editor" : "Configure & deploy"}
                  <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
