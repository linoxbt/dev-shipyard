/**
 * The photography behind the landing page.
 *
 * Real, properly-licensed images (Unsplash License: free commercial use, no
 * attribution required), chosen for what this product is actually about -
 * code on a screen, the machines it deploys to, the silicon underneath -
 * rather than anything abstractly "AI" or "crypto". Every URL below was
 * fetched and confirmed to resolve before it was committed.
 *
 * `alt` is deliberately empty: these are decorative layers sitting behind real
 * text, and a screen reader announcing a stack of photo descriptions behind a
 * headline is noise, not information.
 */
export interface LandingImage {
  src: string;
  alt: string;
  /** What it is, for whoever edits this file next. */
  note: string;
}

const CDN = "https://images.unsplash.com";

/** Sized down at the CDN. These sit behind a tint at low opacity, so shipping
 *  full-resolution photographs to make a watermark would be wasteful. */
function shot(id: string, w = 1400): string {
  return `${CDN}/${id}?auto=format&fit=crop&w=${w}&q=70`;
}

export const HERO_IMAGES: LandingImage[] = [
  { src: shot("photo-1461749280684-dccba630e2f6"), alt: "", note: "code on a screen" },
  { src: shot("photo-1518770660439-4636190af475"), alt: "", note: "circuit board, close up" },
  { src: shot("photo-1544197150-b99a580bb7a8"), alt: "", note: "server racks" },
  { src: shot("photo-1504384308090-c894fdcc538d"), alt: "", note: "a developer's desk" },
];

/** The three full-width reveals down the page, in the order they appear. */
export const REVEAL_IMAGES = {
  write: shot("photo-1555949963-ff9fe0c870eb", 1600),
  deploy: shot("photo-1558494949-ef010cbdcc31", 1600),
  inspect: shot("photo-1526374965328-7f61d4dc18c5", 1600),
} as const;
