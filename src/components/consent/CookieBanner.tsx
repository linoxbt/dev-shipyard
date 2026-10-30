import { useEffect, useState } from "react";
import { useConsent } from "@/lib/consent";
import { cn } from "@/lib/utils";

// The cookie notice: Accept all, Reject all, or Manage preferences. Shown
// until a choice is made, and again from "Cookie preferences" in the account
// sheet. Light on purpose, in both themes, so it reads as a notice rather than
// part of the app.

export function CookieBanner() {
  const { consent, loaded, managing, load, decide, manage } = useConsent();
  const [prefs, setPrefs] = useState(true);

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (managing) setPrefs(consent?.preferences ?? true);
  }, [managing, consent]);

  if (!loaded || (consent && !managing)) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-[70] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-md"
    >
      <div className="ds-sheet rounded-t-[28px] border border-black/10 bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-[#3f3f46] shadow-2xl shadow-black/40 sm:rounded-[24px] sm:pb-6">
        <p className="text-[15.5px] leading-7">
          We use cookies to enhance your experience. By clicking "Accept," you consent to the use of
          all cookies. Learn more in our{" "}
          <a href="/cookies" className="font-medium text-[#b45309] underline underline-offset-2">
            cookie policy
          </a>
          .
        </p>

        {managing && (
          <div className="mt-4 space-y-3 rounded-2xl bg-[#f4f4f5] p-4">
            <Toggle
              title="Essential"
              text="Keeps you signed in, keeps your projects in this browser and remembers this choice. Always on."
              checked
              disabled
            />
            <Toggle
              title="Preferences"
              text="Remembers your theme, the model and mode you last picked, and the chat's width."
              checked={prefs}
              onChange={setPrefs}
            />
            <p className="text-[12.5px] leading-5 text-[#71717a]">
              DevStation uses no analytics, advertising or tracking cookies.
            </p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          {managing ? (
            <>
              <button
                onClick={() => manage(false)}
                className="rounded-lg border border-[#d4d4d8] py-2.5 text-[15px] font-semibold text-[#18181b] hover:bg-[#f4f4f5]"
              >
                Cancel
              </button>
              <button
                onClick={() => decide(prefs)}
                className="rounded-lg bg-[#18181b] py-2.5 text-[15px] font-semibold text-white hover:bg-black"
              >
                Save choices
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => decide(true)}
                className="rounded-lg bg-[#18181b] py-2.5 text-[15px] font-semibold text-white hover:bg-black"
              >
                Accept all
              </button>
              <button
                onClick={() => decide(false)}
                className="rounded-lg bg-[#18181b] py-2.5 text-[15px] font-semibold text-white hover:bg-black"
              >
                Reject all
              </button>
            </>
          )}
        </div>
        {!managing && (
          <button
            onClick={() => manage(true)}
            className="mx-auto mt-3 block text-[15px] font-semibold text-[#52525b] hover:text-[#18181b]"
          >
            Manage preferences
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  title,
  text,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className={cn("flex items-start gap-3", disabled ? "cursor-default" : "cursor-pointer")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-[#18181b]">{title}</span>
        <span className="block text-[13px] leading-5 text-[#52525b]">{text}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          "mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition",
          checked ? "bg-[#18181b]" : "bg-[#d4d4d8]",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow transition",
            checked && "translate-x-5",
          )}
        />
      </button>
    </label>
  );
}
