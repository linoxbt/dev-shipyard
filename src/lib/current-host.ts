import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

/** The hostname this page is being served on: the request's host on the
 *  server, the address bar in the browser. */
export const currentHost = createIsomorphicFn()
  .server(() => getRequestHeader("x-forwarded-host") ?? getRequestHeader("host") ?? "")
  .client(() => window.location.host);
