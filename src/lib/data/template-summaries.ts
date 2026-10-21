import type { Template } from "./templates";

// What a page needs to list the built-in templates, without their Solidity.
//
// templates.ts carries every template's full source and ABI (~50 KB). The
// landing page and the overview only show names and descriptions, so they
// read this through their route loader: on the server it is rendered into the
// page, and in the browser the full module becomes a separate chunk fetched
// only on a client-side navigation instead of riding in the landing bundle.
export type TemplateSummary = Pick<Template, "id" | "name" | "category" | "description">;

export async function loadTemplateSummaries(): Promise<TemplateSummary[]> {
  const { TEMPLATES } = await import("./templates");
  return TEMPLATES.map(({ id, name, category, description }) => ({
    id,
    name,
    category,
    description,
  }));
}
