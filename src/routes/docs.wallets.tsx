import { createFileRoute } from "@tanstack/react-router";
import { DocPage, P, Bullets, PageNav } from "@/components/docs/primitives";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/wallets")({
  head: () => ({ meta: [{ title: "Wallets - DevStation Docs" }] }),
  component: Wallets,
});

function Wallets() {
  const { prev, next } = docNeighbors("/docs/wallets");
  return (
    <DocPage title="Wallets" intro="DevStation works with two kinds of wallet.">
      <Bullets
        items={[
          "Injected wallets such as MetaMask, connected through the standard provider.",
          "An in-app burner wallet generated and held locally, useful for quick testing.",
        ]}
      />
      <P>
        Either way, your connection survives page refreshes. It is cleared only when you disconnect,
        clear your browser data, or close the browser. The selected network, not the wallet&apos;s
        current chain, drives reads across the app; write flows prompt you to switch if the two do
        not match.
      </P>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
