import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { verifyRequestMessage } from "@/lib/qie/request-auth";
import type { PassState, QieClaim } from "@/lib/qie/identity";

// Starting and following a QIE Pass verification.
//
// Deliberately user-initiated. Creating a request makes QIE notify the wallet
// holder and ask them to approve sharing identity data, so it never fires on
// connect or on render: only when someone presses the button.
//
// The request id is kept in this browser so a half-finished verification
// survives a refresh. It is not a secret: it identifies a request the user
// already consented to, and QIE will not release anything without that consent.

const STORAGE_KEY = "devstation-qie-pass-request";
/** How often to ask QIE whether the user has responded yet. Their flow happens
 *  in another tab or on a phone, so this is a human timescale, not a machine
 *  one. */
const POLL_MS = 4000;
/** Stop polling eventually: a request the user abandoned should not have this
 *  tab talking to QIE forever. */
const MAX_POLLS = 90;

/** Claims DevStation asks for: the minimum that answers "is this identity
 *  verified" without requesting personal data it has no use for. Fewer claims
 *  means higher approval rates, and DevStation does not need a date of birth
 *  to show a verified badge. */
const REQUESTED_CLAIMS: QieClaim[] = ["age_over_18"];

type Phase = "idle" | "signing" | "creating" | "waiting" | "done" | "error";

interface Stored {
  requestId: string;
  address: string;
}

function readStored(): Stored | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(v: Stored | null) {
  if (typeof localStorage === "undefined") return;
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota: the flow still works for this session */
  }
}

export interface QiePassFlow {
  phase: Phase;
  pass: PassState | null;
  error: string | null;
  /** True once QIE has confirmed both consent and completed KYC. */
  verified: boolean;
  start: () => Promise<void>;
  reset: () => void;
}

export function useQiePass(configured: boolean): QiePassFlow {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pass, setPass] = useState<PassState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  // Resume a request left unfinished, but only for the wallet that made it -
  // switching wallets must not show someone else's verification.
  useEffect(() => {
    const stored = readStored();
    if (stored && address && stored.address.toLowerCase() === address.toLowerCase()) {
      setRequestId(stored.requestId);
      setPhase("waiting");
    } else {
      setRequestId(null);
      setPhase("idle");
      setPass(null);
    }
  }, [address]);

  const start = useCallback(async () => {
    if (!address || !configured) return;
    setError(null);
    try {
      setPhase("signing");
      const issuedAt = Date.now();
      const signature = await signMessageAsync({
        message: verifyRequestMessage({ address, identifier: address, issuedAt }),
      });

      setPhase("creating");
      const res = await fetch("/api/qie-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          identifier: address,
          claims: REQUESTED_CLAIMS,
          address,
          signature,
          issuedAt,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: PassState;
        message?: string;
      } | null;

      if (!res.ok || !body?.ok || !body.data?.requestId) {
        setError(body?.message ?? "Could not start verification.");
        setPhase("error");
        return;
      }
      setPass(body.data);
      setRequestId(body.data.requestId);
      writeStored({ requestId: body.data.requestId, address });
      setPhase("waiting");
    } catch (e) {
      // A rejected signature is a choice, not a failure worth shouting about.
      const rejected = e instanceof Error && /reject|denied|cancel/i.test(e.message);
      setError(rejected ? null : "Could not start verification.");
      setPhase(rejected ? "idle" : "error");
    }
  }, [address, configured, signMessageAsync]);

  // Poll while QIE waits on the user. Stops on any terminal state so an
  // abandoned request does not keep this tab talking to QIE indefinitely.
  useEffect(() => {
    if (phase !== "waiting" || !requestId) return;
    let polls = 0;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      polls++;
      try {
        const res = await fetch("/api/qie-identity", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "status", requestId }),
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: PassState;
        } | null;
        if (cancelled) return;

        if (body?.ok && body.data) {
          setPass(body.data);
          const terminal =
            body.data.status === "consent_given" ||
            body.data.status === "consent_rejected" ||
            body.data.status === "expired" ||
            body.data.status === "failed";
          if (terminal) {
            setPhase("done");
            if (body.data.status !== "consent_given") writeStored(null);
            return;
          }
        }
      } catch {
        // A dropped poll is not a failed verification; the next one retries.
      }
      if (polls >= MAX_POLLS) {
        setPhase("done");
        return;
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    let timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, requestId]);

  const reset = useCallback(() => {
    writeStored(null);
    setRequestId(null);
    setPass(null);
    setError(null);
    setPhase("idle");
  }, []);

  return {
    phase,
    pass,
    error,
    verified: pass?.status === "consent_given" && pass.userStatus === "verified",
    start,
    reset,
  };
}
