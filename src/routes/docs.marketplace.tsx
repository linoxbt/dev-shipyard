import { createFileRoute } from "@tanstack/react-router";
import { Store } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Table,
  Callout,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/marketplace")({
  head: () => ({ meta: [{ title: "Buying & Deploying · DevStation Docs" }] }),
  component: MarketplaceDocs,
});

function MarketplaceDocs() {
  return (
    <DocPage
      title="Buying & Deploying"
      icon={Store}
      intro="The Marketplace is where builders share and sell what they have made: contract templates, apps, agent skills and UI kits. Every listing, purchase and payout is recorded by a contract on QIE Mainnet."
    >
      <H2>What is for sale</H2>
      <Table
        head={["Kind", "What you get", "What you do with it"]}
        rows={[
          [
            "Template",
            "Solidity source and its ABI",
            "Deploy it, or open it in the Contract Editor.",
          ],
          [
            "App",
            "A complete app's files",
            "Open it as a new app in the Coding Agent, change it, publish it.",
          ],
          [
            "Skill",
            "Reusable instructions for an AI agent",
            "Use it with the DevStation CLI or another agent.",
          ],
          ["UI kit", "Front-end components and styles", "Add them to an app you are building."],
        ]}
      />

      <H3>Where listings come from</H3>
      <Bullets
        items={[
          <>
            <strong className="text-foreground">Official</strong>: the templates that ship with
            DevStation. Most are free; Stablecoin Invoices and Token Vesting are paid.
          </>,
          <>
            <strong className="text-foreground">Community</strong>: listings published by builders
            through the Marketplace contract.
          </>,
          <>
            <strong className="text-foreground">Classic templates</strong>: templates published to
            the earlier TemplateRegistry, whose source is stored on chain.
          </>,
        ]}
      />

      <H2>Browse</H2>
      <P>
        Open <ConsoleLink to="/launchkit/marketplace">Marketplace</ConsoleLink> and filter or search
        the listings. Creators can pay to feature a listing. Each listing page shows its creator,
        price and pricing model, sales and deploy counts, details, tags and a live demo link where
        the creator added one.
      </P>

      <H2>Buy</H2>
      <Steps
        steps={[
          {
            title: "Switch to QIE Mainnet",
            body: "Community listings live there. The listing page asks you to switch if you are elsewhere.",
          },
          {
            title: "Check the pricing model",
            body: (
              <Table
                head={["Model", "You pay"]}
                rows={[
                  ["One-time", "Once. Keep it, and deploy it as often as you like."],
                  ["Per deploy", "Each time you deploy it."],
                  ["Free", "Nothing. Price 0."],
                ]}
              />
            ),
          },
          {
            title: "Pay",
            body: "Prices are in QIE or QUSDC. For QUSDC your wallet first approves the amount, then pays it.",
          },
          {
            title: "Open it",
            body: "The files unlock as soon as the purchase confirms. They stay yours: your Library lists everything the wallet has bought.",
          },
        ]}
      />
      <P>
        Every sale pays the creator 95%; DevStation keeps 5%. Before you buy, the listing shows its
        file list but not the contents.
      </P>

      <H2>Your library</H2>
      <P>
        <ConsoleLink to="/launchkit/marketplace/library">Library</ConsoleLink> lists everything the
        connected wallet has bought. Access is checked on chain, so it follows the wallet to any
        browser.
      </P>

      <H2>Tip a creator</H2>
      <P>
        Any listing can be tipped, in QIE or QUSDC, whether or not you bought it. Tips go to the
        creator in full; DevStation takes nothing.
      </P>

      <H2>What you downloaded is what was listed</H2>
      <P>
        When a listing is published, the Marketplace contract stores a SHA-256 hash of its files.
        The server that stores the files refuses any upload that does not match that hash, and your
        browser checks the files it receives against it too. A creator can publish new content, but
        not swap files without the change being recorded on chain.
      </P>

      <Callout>
        Listings can be hidden for abuse. A hidden listing cannot be bought, tipped, featured or
        downloaded. Official templates are part of DevStation; they are not a third-party audit.
      </Callout>

      <P>
        Want to sell? See <DocLink to="/docs/selling">Selling &amp; Earnings</DocLink>. Contract
        address: <C>0xeeae4de6198cbcc837240115e86554c6968ba51d</C> on QIE Mainnet.
      </P>
    </DocPage>
  );
}
