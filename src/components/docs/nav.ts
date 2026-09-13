// Single source of truth for the docs navigation: the sidebar, the search
// palette, the breadcrumb above each page, and the prev/next links under it.

export interface DocLink {
  to: string;
  label: string;
  /** One line, shown in search results. */
  description: string;
}

export interface DocGroup {
  group: string;
  items: DocLink[];
}

export const DOC_NAV: DocGroup[] = [
  {
    group: "Getting Started",
    items: [
      {
        to: "/docs",
        label: "Introduction",
        description: "What DevStation is, and where each part of it lives.",
      },
      {
        to: "/docs/quickstart",
        label: "Quickstart",
        description: "Connect a wallet and deploy your first contract.",
      },
      {
        to: "/docs/networks",
        label: "Networks",
        description: "QIE and BOT Chain: chain IDs, RPCs, explorers, faucets.",
      },
      {
        to: "/docs/wallets",
        label: "Wallets",
        description: "Browser wallets, the DevStation wallet, and network mismatches.",
      },
    ],
  },
  {
    group: "Console",
    items: [
      {
        to: "/docs/console",
        label: "Overview & Analytics",
        description: "The overview, analytics, leaderboard and settings.",
      },
      {
        to: "/docs/dashboard",
        label: "Builder Dashboard",
        description: "Your dashboard, public profiles, achievements and tiers.",
      },
      {
        to: "/docs/qie-id",
        label: "QIE ID",
        description: ".qie names: how they are registered, read and shown.",
      },
    ],
  },
  {
    group: "Build",
    items: [
      {
        to: "/docs/launchkit",
        label: "Deploy a Contract",
        description: "Built-in templates and the three-step deploy flow.",
      },
      {
        to: "/docs/editor",
        label: "Contract Editor",
        description: "Write, compile and deploy Solidity in the browser.",
      },
      {
        to: "/docs/ai",
        label: "Code with AI",
        description: "Chat and Agent modes, providers and API keys.",
      },
      {
        to: "/docs/coding-agent",
        label: "Coding Agent",
        description: "Build an app from a prompt, or change a GitHub repository.",
      },
      {
        to: "/docs/apps",
        label: "Apps & Publishing",
        description: "Your apps, publishing to <name>.devstation.online, pushing to GitHub.",
      },
    ],
  },
  {
    group: "Marketplace",
    items: [
      {
        to: "/docs/marketplace",
        label: "Buying & Deploying",
        description: "Browse, buy, tip and deploy templates, apps, skills and UI kits.",
      },
      {
        to: "/docs/selling",
        label: "Selling & Earnings",
        description: "List your work, pricing models, featuring, fees and withdrawals.",
      },
    ],
  },
  {
    group: "DevStation CLI",
    items: [
      {
        to: "/docs/cli",
        label: "CLI Overview",
        description: "The coding agent in your terminal, and how it works.",
      },
      {
        to: "/docs/cli/install",
        label: "Installation",
        description: "Install with the script, npm or by hand, then check it.",
      },
      {
        to: "/docs/cli/models",
        label: "Models & Providers",
        description: "devstation login, config files, endpoints and precedence.",
      },
      {
        to: "/docs/cli/sessions",
        label: "Sessions & Commands",
        description: "Sessions, one-shot runs, repositories, slash commands, plan mode, skills.",
      },
      {
        to: "/docs/cli/permissions",
        label: "Permissions & Sandbox",
        description: "What it asks before doing, autonomy levels, the container, web tools.",
      },
      {
        to: "/docs/cli/workspace",
        label: "Undo, Memory & MCP",
        description: "Checkpoints, the search index, project memory and MCP servers.",
      },
      {
        to: "/docs/cli/reference",
        label: "CLI Reference",
        description: "Every command, flag and environment variable, and the files it writes.",
      },
      {
        to: "/docs/cli/troubleshooting",
        label: "Troubleshooting",
        description: "devstation doctor, common symptoms, upgrading and uninstalling.",
      },
    ],
  },
  {
    group: "Routebook",
    items: [
      {
        to: "/docs/routebook",
        label: "Inspect Transactions",
        description: "Decode a transaction into calls, arguments, transfers and events.",
      },
      {
        to: "/docs/labels",
        label: "Label Registry",
        description: "Human-readable names for contracts, stored onchain.",
      },
    ],
  },
  {
    group: "Explorer",
    items: [
      {
        to: "/docs/explorer",
        label: "Block Explorer",
        description: "Blocks, transactions, addresses, tokens and contracts.",
      },
      {
        to: "/docs/verification",
        label: "Contract Verification",
        description: "Publish a contract's source on the network explorer.",
      },
    ],
  },
  {
    group: "Reference",
    items: [
      {
        to: "/docs/registries",
        label: "Contracts & Registries",
        description: "The contracts DevStation runs on, and their addresses.",
      },
      {
        to: "/docs/faq",
        label: "FAQ",
        description: "Common questions about DevStation.",
      },
    ],
  },
];

// Flat, ordered list for prev/next navigation.
export const DOC_ORDER: DocLink[] = DOC_NAV.flatMap((g) => g.items);

export function docNeighbors(pathname: string): {
  prev?: DocLink;
  next?: DocLink;
} {
  const path = normaliseDocPath(pathname);
  const i = DOC_ORDER.findIndex((d) => d.to === path);
  if (i === -1) return {};
  return {
    prev: i > 0 ? DOC_ORDER[i - 1] : undefined,
    next: i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : undefined,
  };
}

export function docGroupOf(pathname: string): string | undefined {
  const path = normaliseDocPath(pathname);
  return DOC_NAV.find((g) => g.items.some((i) => i.to === path))?.group;
}

/** /docs/cli/ and /docs/cli are the same page. */
export function normaliseDocPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
