import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pass-through for everything under /explorer. The chrome + network label live
// in the network-scoped layout (/explorer/$network) so the URL always names the
// chain it is showing.
export const Route = createFileRoute("/explorer")({
  component: () => <Outlet />,
});
