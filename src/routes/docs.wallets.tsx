import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { DocPage, H2, P, Bullets, Callout, ConsoleLink } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/wallets")({
  head: () => ({ meta: [{ title: "Wallets · DevStation Docs" }] }),
  component: Wallets,
});

function Wallets() {
  return (
    <DocPage
      title="Wallets"
      icon={Wallet}
      intro="Your wallet is your account. There is no sign-up: deployments, purchases, earnings and your profile all belong to the wallet that made them."
    >
      <H2>Two kinds of wallet</H2>
      <Bullets
        items={[
          <>
            <strong className="text-foreground">A browser wallet</strong>, such as MetaMask or any
            other EVM wallet. Connect it from the wallet panel at the top of the sidebar.
          </>,
          <>
            <strong className="text-foreground">A DevStation wallet</strong>, generated in the
            console. Its recovery phrase is shown before you can continue, and it is kept in this
            browser only. Good for trying things out; keep real funds in a wallet you control
            elsewhere.
          </>,
        ]}
      />

      <H2>Staying connected</H2>
      <P>
        Your connection survives page refreshes. It is cleared when you disconnect, clear your
        browser data, or close the browser. For a DevStation wallet,{" "}
        <ConsoleLink to="/settings">Settings</ConsoleLink> controls how long it stays unlocked.
      </P>

      <H2>Network mismatches</H2>
      <P>
        The network selected in the sidebar decides where things are read and sent, not the chain
        your wallet happens to be on. Before any transaction, the console checks the two agree and
        asks the wallet to switch if they do not.
      </P>

      <H2>Your wallet across DevStation</H2>
      <Bullets
        items={[
          "Deployments are recorded against it in the ProjectRegistry.",
          "Marketplace listings, purchases, tips and earnings belong to it.",
          "Your dashboard and public profile are keyed to its address.",
          "A .qie name it holds becomes your display name.",
          "Published apps can only be overwritten by the wallet that published them.",
        ]}
      />

      <Callout tone="warning">
        DevStation never asks for your recovery phrase or private key after a wallet is created, and
        no one from DevStation will. Anyone who asks for it is trying to take your funds.
      </Callout>
    </DocPage>
  );
}
