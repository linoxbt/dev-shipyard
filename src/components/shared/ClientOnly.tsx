import { useEffect, useState, type ReactNode } from "react";

// Renders children only after mount, so browser-only libraries (Monaco) never
// execute during SSR. Shows an optional fallback until hydrated.
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}
