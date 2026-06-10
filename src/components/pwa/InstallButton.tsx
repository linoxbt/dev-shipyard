import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

// Captured beforeinstallprompt event (not in the standard lib types).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Shows an "Install app" button when the browser offers the PWA install prompt
// (Chrome/Edge/Android). Hidden when already installed or unsupported (for
// example iOS Safari, which installs via the Share menu). Progressive
// enhancement: nothing breaks if it never appears.
export function InstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred) return null;

  return (
    <button
      onClick={async () => {
        await deferred.prompt();
        await deferred.userChoice.catch(() => undefined);
        setDeferred(null);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10",
        className,
      )}
      title="Install DevStation as an app"
    >
      <Download className="h-3.5 w-3.5" /> Install app
    </button>
  );
}
