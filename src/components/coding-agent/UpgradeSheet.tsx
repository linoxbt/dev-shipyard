import { useState } from "react";
import { Check, Crown, Gift, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { changePlan, type Access } from "@/lib/coding-agent/account-client";
import { AGENT_MODELS } from "@/lib/coding-agent/models";
import { ModelLogo } from "./pickers";
import { Modal } from "./primitives";

// What the crown on a model opens: the launch credit ($5 each for the first
// 20 accounts), and Pro, which unlocks every model for good.

export function UpgradeSheet({
  access,
  signedIn,
  onSignIn,
  onChange,
  onClose,
}: {
  access: Access | null;
  signedIn: boolean;
  onSignIn: () => void;
  onChange: (access: Access) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<null | "claim" | "request_pro">(null);
  const premium = AGENT_MODELS.filter((m) => m.family !== "qwen");

  const act = async (action: "claim" | "request_pro") => {
    setBusy(action);
    const r = await changePlan(action);
    setBusy(null);
    if (!r.ok) return toast.error(r.message);
    onChange(r.data);
    toast.success(
      action === "claim"
        ? "$5 of launch credit is yours. Every model is unlocked."
        : "Pro requested. You will hear from us soon.",
    );
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Crown className="h-6 w-6" />
        </span>
        <p className="mt-3 text-[19px] font-semibold tracking-tight text-foreground">
          Unlock every model
        </p>
        <p className="mt-1 max-w-xs text-[13px] leading-5 text-muted-foreground">
          Qwen 3.8 27B is free. Claude, GPT and Gemini need Pro or launch credit.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {premium.slice(0, 6).map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              <ModelLogo id={m.id} className="h-3 w-3" /> {m.label}
            </span>
          ))}
        </div>
      </div>

      {!signedIn ? (
        <button
          onClick={onSignIn}
          className="mt-5 w-full rounded-full bg-primary py-3 text-[14px] font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Sign in to upgrade
        </button>
      ) : access && !access.available ? (
        <p className="mt-5 rounded-xl bg-surface-2 px-4 py-3 text-center text-[12.5px] text-muted-foreground">
          Upgrades open soon. Qwen stays free in the meantime.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-border p-4">
            <p className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Gift className="h-4 w-4 text-primary" /> Launch credit
            </p>
            {access && access.claimed > 0 ? (
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                ${access.balance.toFixed(2)} of ${access.claimed.toFixed(2)} left, spent at each
                model's real cost.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                  $5 for each of the first 20 accounts, to spend on any model.{" "}
                  {access ? `${access.slotsLeft} of 20 left.` : ""}
                </p>
                <button
                  onClick={() => void act("claim")}
                  disabled={!!busy || !access || access.slotsLeft === 0}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === "claim" && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {access?.slotsLeft === 0 ? "All claimed" : "Claim $5 credit"}
                </button>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
            <p className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Crown className="h-4 w-4 text-primary" /> DevStation Pro
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Every model, with no credit to run out.
            </p>
            {access?.plan === "pro" ? (
              <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-success">
                <Check className="h-4 w-4" /> You are on Pro
              </p>
            ) : access?.proRequested ? (
              <p className="mt-3 text-[12.5px] text-foreground">
                Requested. We will be in touch to turn it on.
              </p>
            ) : (
              <button
                onClick={() => void act("request_pro")}
                disabled={!!busy}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-primary py-2.5 text-[13.5px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {busy === "request_pro" && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
