import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { useConsent } from "@/lib/consent";

// The cookie policy: every cookie and browser-storage item DevStation uses,
// what it is for and how long it lasts, and how to change your choice.

export const Route = createFileRoute("/cookies")({
  head: () => ({ meta: [{ title: "Cookie policy: DevStation" }] }),
  component: CookiePolicy,
});

const ESSENTIAL: [string, string, string, string][] = [
  [
    "devstation_jobs",
    "Cookie",
    "Says you are signed in and which agent workspaces are yours. httpOnly: page scripts cannot read it.",
    "24 hours",
  ],
  [
    "devstation_gh, devstation_gh_state, devstation_gh_return",
    "Cookies",
    "Only if you connect GitHub: your GitHub session (encrypted), and the sign-in round trip.",
    "30 days; 10 minutes for the round trip",
  ],
  ["devstation_access_nonce", "Cookie", "A one-time code used while signing in.", "10 minutes"],
  [
    "sb-…-auth-token",
    "Local storage",
    "Your email sign-in session with Supabase, which runs DevStation's accounts.",
    "Until you sign out",
  ],
  [
    "devstation-apps-v1",
    "Local storage",
    "Your projects: their files and conversations live in this browser.",
    "Until you delete them",
  ],
  [
    "devstation-consent",
    "Local storage",
    "This choice, so you are not asked again.",
    "Until you change it",
  ],
];

const PREFERENCES: [string, string, string, string][] = [
  ["devstation-theme", "Local storage", "Light or dark theme.", "Until changed"],
  [
    "devstation-agent-model, devstation-agent-mode",
    "Local storage",
    "The model and the mode (Build or Plan) you last picked.",
    "Until changed",
  ],
  [
    "Layout keys",
    "Local storage",
    "How wide you made the chat beside the preview.",
    "Until changed",
  ],
  [
    "devstation-agent-news-seen",
    "Local storage",
    "Which updates you have already seen.",
    "Until changed",
  ],
];

function CookiePolicy() {
  const manage = useConsent((s) => s.manage);
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-8">
        <a href="/" className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <LogoMark className="h-7 w-7" /> DevStation
        </a>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the app
        </a>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Cookie policy</h1>
        <p className="mt-2 text-[13px] text-meta">Last updated 30 October 2026</p>

        <div className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <p>
            DevStation keeps a small amount of information in your browser: cookies, which are sent
            to our server, and local storage, which stays in your browser. This page lists all of
            it.
          </p>
          <p>
            <strong className="text-foreground">
              We do not use analytics, advertising or tracking cookies
            </strong>
            , and no third party sets cookies through DevStation. Accounts are run by Supabase; if
            you connect GitHub, GitHub's own sign-in page sets its cookies on github.com, not here.
          </p>
        </div>

        <Section
          title="Essential"
          text="Needed for DevStation to work: signing in, keeping your projects and remembering your cookie choice. They cannot be turned off, because without them the product does not work."
          rows={ESSENTIAL}
        />
        <Section
          title="Preferences"
          text="Only remember how you like things. Stored only if you accept them; refuse them and these choices last for your visit, and any already saved are deleted."
          rows={PREFERENCES}
        />

        <h2 className="mt-12 text-xl font-semibold text-foreground">Changing your choice</h2>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
          You can change it at any time, here or from Cookie preferences in your account menu.
          Clearing this site's data in your browser removes everything above, including the projects
          stored in it.
        </p>
        <button
          onClick={() => manage(true)}
          className="mt-4 rounded-full bg-primary px-5 py-2.5 text-[14px] font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Cookie preferences
        </button>
      </main>
    </div>
  );
}

function Section({
  title,
  text,
  rows,
}: {
  title: string;
  text: string;
  rows: [string, string, string, string][];
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{text}</p>
      <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {rows.map(([name, kind, purpose, lasts]) => (
          <div key={name} className="grid gap-1 bg-surface px-4 py-3 sm:grid-cols-[1fr_2fr]">
            <div>
              <p className="break-words font-mono text-[12.5px] text-foreground">{name}</p>
              <p className="text-[12px] text-meta">{kind}</p>
            </div>
            <div>
              <p className="text-[14px] leading-6 text-foreground/90">{purpose}</p>
              <p className="text-[12.5px] text-meta">Lasts: {lasts}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
