import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Per-listing activity for the marketplace: tips from the chain, and clones and
// downloads counted by DevStation (services/runner/src/activity.ts). Sales and
// deploys already come with the listings themselves.
//
// Server-only modules are imported inside the handlers, so nothing of them
// reaches the browser bundle that imports these functions.

export interface ListingStats {
  tips: number;
  clones: number;
  downloads: number;
}

export const getMarketplaceStats = createServerFn({ method: "GET" })
  .inputValidator(z.object({ chainId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [{ readListingActivity }, { marketplaceEvents }] = await Promise.all([
      import("@/lib/api/marketplace-activity.server"),
      import("@/lib/api/marketplace-logs.server"),
    ]);
    const [activity, tipped] = await Promise.all([
      readListingActivity(),
      marketplaceEvents(data.chainId, "Tipped"),
    ]);

    const listings: Record<string, ListingStats> = {};
    const row = (id: string) => (listings[id] ??= { tips: 0, clones: 0, downloads: 0 });
    for (const [id, counts] of Object.entries(activity ?? {})) {
      row(id).clones = counts.clone;
      row(id).downloads = counts.download;
    }
    // A creator tipping their own listing is not a tip.
    for (const tip of tipped ?? []) {
      if (tip.actor !== tip.creator) row(`m-${tip.id}`).tips += 1;
    }

    return {
      /** False when the runner could not be reached: clones and downloads are unknown, not zero. */
      activityAvailable: activity !== null,
      /** False when there is no marketplace on this chain or the explorer did not answer. */
      tipsAvailable: tipped !== null,
      listings,
    };
  });

const LISTING_ID = /^(?:b-[a-z0-9-]{1,80}|m-\d{1,9}|t-\d{1,9})$/;
const HOUR_MS = 60 * 60 * 1000;

/** Counts one clone or download. The runner keeps it to once a day per person:
 *  the signed-in wallet when there is one, otherwise the client address. */
export const recordMarketplaceActivity = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      listing: z.string().regex(LISTING_ID),
      action: z.enum(["clone", "download"]),
    }),
  )
  .handler(async ({ data }) => {
    const [server, limits, claims, { recordListingActivity }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/rateLimit.server"),
      import("@/lib/agent-access/claims.server"),
      import("@/lib/api/marketplace-activity.server"),
    ]);
    const caller = limits.clientKeyFromRequest(server.getRequest());
    if (!limits.checkRateLimit(`marketplace-activity:${caller}`, 120, HOUR_MS)) {
      return { counted: false };
    }
    const wallet = claims.ownerOf(
      claims.openClaims(claims.readCookie(server.getRequestHeader("cookie"), claims.CLAIM_COOKIE)),
    );
    const result = await recordListingActivity({
      listing: data.listing,
      action: data.action,
      caller,
      wallet,
    });
    return { counted: result.counted };
  });
