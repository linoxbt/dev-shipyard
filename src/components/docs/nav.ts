// Single source of truth for the docs navigation: the hamburger/sidebar list,
// and the ordered page sequence that powers prev/next links.

export interface DocLink {
  to: string;
  label: string;
}

export interface DocGroup {
  group: string;
  items: DocLink[];
}

export const DOC_NAV: DocGroup[] = [
  {
    group: "Getting Started",
    items: [
      { to: "/docs", label: "Introduction" },
      { to: "/docs/quickstart", label: "Quickstart" },
      { to: "/docs/networks", label: "Networks" },
    ],
  },
  {
    group: "LaunchKit",
    items: [
      { to: "/docs/launchkit", label: "Templates & Deploy" },
      { to: "/docs/editor", label: "Contract Editor" },
      { to: "/docs/ai", label: "Code with AI" },
    ],
  },
  {
    group: "Routebook",
    items: [
      { to: "/docs/routebook", label: "Inspect Transactions" },
      { to: "/docs/labels", label: "Label Registry" },
    ],
  },
  {
    group: "Explorer",
    items: [{ to: "/docs/explorer", label: "QIE Explorer" }],
  },
  {
    group: "Platform",
    items: [
      { to: "/docs/registries", label: "Onchain Registries" },
      { to: "/docs/verification", label: "Contract Verification" },
      { to: "/docs/wallets", label: "Wallets" },
    ],
  },
  {
    group: "Help",
    items: [{ to: "/docs/faq", label: "FAQ" }],
  },
];

// Flat, ordered list for prev/next navigation.
export const DOC_ORDER: DocLink[] = DOC_NAV.flatMap((g) => g.items);

export function docNeighbors(pathname: string): {
  prev?: DocLink;
  next?: DocLink;
} {
  const i = DOC_ORDER.findIndex((d) => d.to === pathname);
  if (i === -1) return {};
  return {
    prev: i > 0 ? DOC_ORDER[i - 1] : undefined,
    next: i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : undefined,
  };
}
