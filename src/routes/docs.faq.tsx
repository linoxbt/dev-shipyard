import { createFileRoute } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";
import { DocPage, H2, FaqItem, DocLink, C } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/faq")({
  head: () => ({ meta: [{ title: "FAQ · DevStation Docs" }] }),
  component: Faq,
});

function Faq() {
  return (
    <DocPage title="FAQ" icon={HelpCircle} intro="Common questions about DevStation.">
      <H2>General</H2>
      <div className="space-y-2">
        <FaqItem
          q="Is DevStation free?"
          a="The console is free. You pay the network's gas for transactions you send, the price of anything you buy on the Marketplace, and your AI provider for the model calls you make."
        />
        <FaqItem
          q="Do I need to install anything?"
          a={
            <>
              Not for the console: compiling runs in the browser and deploys go through your wallet.
              The <DocLink to="/docs/cli">DevStation CLI</DocLink> is optional, for working on
              projects on your own machine.
            </>
          }
        />
        <FaqItem
          q="Do I need an account?"
          a="No. Your wallet is your account. Deployments, purchases, listings and your profile belong to it."
        />
        <FaqItem
          q="Which networks are supported?"
          a={
            <>
              QIE Mainnet and Testnet, and BOT Chain Mainnet and Testnet. See{" "}
              <DocLink to="/docs/networks">Networks</DocLink>.
            </>
          }
        />
      </div>

      <H2>Data</H2>
      <div className="space-y-2">
        <FaqItem
          q="Where are my deployments stored?"
          a="In the onchain ProjectRegistry, against the wallet that deployed them. That is why they show up in any browser you connect the wallet in."
        />
        <FaqItem
          q="How are total contracts and builders counted?"
          a="Total contracts is the ProjectRegistry's onchain counter on each network, added up. Builders is the number of distinct wallets that have recorded a deployment."
        />
        <FaqItem
          q="Where are the apps I build kept?"
          a="In your browser while you build them. Publish an app, push it to GitHub, or list it on the Marketplace to keep a copy somewhere else."
        />
        <FaqItem
          q="Can a leaderboard position or dashboard stat be faked?"
          a="No. They are computed from onchain records. Reverted transactions are excluded, and nothing on a profile can be edited by hand."
        />
      </div>

      <H2>Marketplace</H2>
      <div className="space-y-2">
        <FaqItem
          q="What does DevStation take from a sale?"
          a="5% of purchases and per-deploy payments. Tips go to the creator in full."
        />
        <FaqItem
          q="Which currencies can I use?"
          a="QIE and QUSDC, on QIE Mainnet. The creator chooses one per listing."
        />
        <FaqItem
          q="I bought something. Where is it?"
          a="In your Library on the Marketplace. Access is checked on chain, so it follows your wallet."
        />
      </div>

      <H2>CLI</H2>
      <div className="space-y-2">
        <FaqItem
          q="Does my code leave my machine?"
          a="Only what is sent to the model provider you chose, as part of the conversation. Sessions, the index and memory stay in the workspace."
        />
        <FaqItem
          q="npm install -g devstation installed something else."
          a={
            <>
              That is an unrelated package. Remove it with <C>npm uninstall -g devstation</C>, run{" "}
              <C>hash -r</C>, then install <C>@devstationlabs/cli</C>.
            </>
          }
        />
        <FaqItem
          q="Can it push to my repository?"
          a="No. It can propose a pull request that you approve, but it cannot push or merge on its own."
        />
      </div>
    </DocPage>
  );
}
