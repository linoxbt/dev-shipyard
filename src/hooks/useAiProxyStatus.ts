import { useQuery } from "@tanstack/react-query";

// Asks the /api/ai server route whether an operator-provided key is configured,
// so the UI can offer "use the provided default" only when it will actually work.
export function useAiProxyStatus() {
  return useQuery({
    queryKey: ["ai-proxy-status"],
    queryFn: async () => {
      try {
        const r = await fetch("/api/ai", { method: "GET" });
        if (!r.ok) return { configured: false };
        return (await r.json()) as { configured: boolean };
      } catch {
        return { configured: false };
      }
    },
    staleTime: 60_000,
  });
}
