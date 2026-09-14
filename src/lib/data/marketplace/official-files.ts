import type { Bundle } from "@/lib/marketplace/bundle";

// The files of each official listing, as text, loaded only when a listing page
// asks for them: nobody browsing the marketplace downloads every app and kit.

const loaders = import.meta.glob("./official/*/files/**/*", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export async function officialFiles(slug: string): Promise<Bundle> {
  const prefix = `./official/${slug}/files/`;
  const entries = await Promise.all(
    Object.entries(loaders)
      .filter(([path]) => path.startsWith(prefix))
      .map(async ([path, load]) => [path.slice(prefix.length), await load()] as const),
  );
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
