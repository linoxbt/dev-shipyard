import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "@/components/layout/AppShell";
import { Web3Provider } from "@/components/web3/Web3Provider";
import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <p className="mt-4 text-muted-foreground">Route not found in DevStation.</p>
        <a href="/" className="mt-6 inline-block text-primary hover:underline">
          {"> return to overview"}
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center font-mono">
        <h1 className="text-xl font-bold text-danger">[DevStation] runtime error</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "DevStation — QIE Builder Console" },
      // PWA: installable as an app ("Add to Home Screen").
      { name: "theme-color", content: "#0a0e13" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "DevStation" },
      { name: "application-name", content: "DevStation" },
      {
        name: "description",
        content: "Unified deploy & debug console for the QIE blockchain. LaunchKit + Routebook.",
      },
      { property: "og:title", content: "DevStation — QIE Builder Console" },
      {
        property: "og:description",
        content: "Unified deploy & debug console for the QIE blockchain. LaunchKit + Routebook.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "DevStation — QIE Builder Console" },
      {
        name: "twitter:description",
        content: "Unified deploy & debug console for the QIE blockchain. LaunchKit + Routebook.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/ecdf74d6-e099-4fd5-81aa-f3d3e6c333fe",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/ecdf74d6-e099-4fd5-81aa-f3d3e6c333fe",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Apply the persisted theme before paint to avoid a flash of dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('devstation-theme')==='light'){document.documentElement.classList.add('light');document.documentElement.classList.remove('dark')}}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const hydrateTheme = useTheme((s) => s.hydrate);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isLanding = pathname === "/";

  // Re-apply the persisted theme on mount (covers client navigation / hydration).
  useEffect(() => {
    hydrateTheme();
  }, [hydrateTheme]);

  // Register the service worker so the app is installable ("Add to Home Screen").
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW registration is best-effort; the app works fine without it */
      });
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Web3Provider>
        {isLanding ? (
          <Outlet />
        ) : (
          <AppShell>
            <Outlet />
          </AppShell>
        )}
        <Toaster />
      </Web3Provider>
    </QueryClientProvider>
  );
}
