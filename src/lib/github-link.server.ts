// The one check every route that acts on GitHub with a person's session runs.
//
// The OAuth cookie says which GitHub account; the access grant says which
// wallet. "One GitHub account per wallet" only means something if every action
// taken with the token checks that the two are the pair that was linked. Only
// the push route did; opening a pull request and importing a private repo used
// the bare cookie, so any GitHub session in the browser acted for any wallet.

import { COOKIE_NAME, openSession, readCookie } from "./github-oauth.server";
import { accountOf, githubUser, grantedOwner } from "./accounts.server";
import { clientKeyFromRequest } from "./rateLimit.server";

export type LinkedGithub =
  | { ok: true; token: string; owner: string; login: string }
  | { ok: false; reason: string; message: string; status: number };

export async function linkedGithub(request: Request, action = "do that"): Promise<LinkedGithub> {
  const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
  if (!token) {
    return {
      ok: false,
      reason: "not_signed_in",
      message: "Connect your GitHub account first.",
      status: 401,
    };
  }
  const owner = grantedOwner(request);
  if (!owner) {
    return {
      ok: false,
      reason: "no_grant",
      message: `Connect a wallet and sign once to ${action}. It costs no gas.`,
      status: 401,
    };
  }
  const user = await githubUser(token);
  if (!user) {
    return {
      ok: false,
      reason: "not_signed_in",
      message: "Connect your GitHub account first.",
      status: 401,
    };
  }
  const account = await accountOf(owner, clientKeyFromRequest(request));
  if (!account) {
    return {
      ok: false,
      reason: "unreachable",
      message: "Your account could not be read right now.",
      status: 502,
    };
  }
  if (account.github?.id !== user.id) {
    return {
      ok: false,
      reason: "not_linked",
      message: account.github
        ? `This wallet is linked to @${account.github.login}, not @${user.login}.`
        : `Link @${user.login} to this wallet before you ${action}.`,
      status: 403,
    };
  }
  return { ok: true, token, owner, login: user.login };
}
