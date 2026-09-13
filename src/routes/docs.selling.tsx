import { createFileRoute } from "@tanstack/react-router";
import { BadgeDollarSign } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Table,
  Callout,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/selling")({
  head: () => ({ meta: [{ title: "Selling & Earnings · DevStation Docs" }] }),
  component: SellingDocs,
});

function SellingDocs() {
  return (
    <DocPage
      title="Selling & Earnings"
      icon={BadgeDollarSign}
      intro="List what you have built. Buyers pay in QIE or QUSDC, you keep 95% of every sale, and tips are all yours."
    >
      <H2>List something</H2>
      <Steps
        steps={[
          {
            title: "Open Sell",
            body: (
              <P>
                Go to <ConsoleLink to="/launchkit/marketplace/sell">Sell</ConsoleLink>, connect the
                wallet you want paid, and switch to QIE Mainnet.
              </P>
            ),
          },
          {
            title: "Choose what to sell",
            body: (
              <Bullets
                items={[
                  "A template: start from one you saved, or paste Solidity. It must contain a deployable contract.",
                  "An app: choose one you built with the Coding Agent. Its files are packaged for you.",
                  "A skill or UI kit: add the files that make it up.",
                ]}
              />
            ),
          },
          {
            title: "Describe it",
            body: (
              <Bullets
                items={[
                  "A name, and a one-line description of what it does.",
                  "Details shown before purchase: features, how to use it, what is included.",
                  "Tags, so it can be found.",
                  "An optional live demo link.",
                ]}
              />
            ),
          },
          {
            title: "Price it",
            body: (
              <Table
                head={["Choice", "Options"]}
                rows={[
                  ["Currency", "QIE, or QUSDC for a dollar price that stays put."],
                  [
                    "Model",
                    "One-time: buy it, keep it. Per deploy: paid again every time someone deploys it.",
                  ],
                  ["Price", "Any amount, or 0 to give it away."],
                ]}
              />
            ),
          },
          {
            title: "Publish",
            body: "Your wallet signs one transaction that creates the listing and records the hash of its files. The files are then uploaded and checked against that hash.",
          },
        ]}
      />

      <H3>Limits</H3>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["Files per listing", "200"],
          ["Total size", "10 MB"],
          ["Listing details", "4,000 bytes of metadata"],
        ]}
      />

      <H2>Fees</H2>
      <Table
        head={["Payment", "You receive", "DevStation"]}
        rows={[
          ["One-time purchase", "95%", "5%"],
          ["Per-deploy fee", "95%", "5%"],
          ["Tip", "100%", "0%"],
        ]}
      />
      <P>The fee is fixed in the contract, and it rounds in your favour.</P>

      <H2>Earnings and withdrawals</H2>
      <P>
        <ConsoleLink to="/launchkit/marketplace/creator">Earnings</ConsoleLink> shows what you have
        sold, tips received, what is waiting to be withdrawn, and how each listing is doing.
        Payments accumulate in the contract for your wallet; withdraw each currency whenever you
        like, in one transaction. Your totals also appear on your{" "}
        <DocLink to="/docs/dashboard">dashboard</DocLink>.
      </P>

      <H2>Managing a listing</H2>
      <Bullets
        items={[
          "Change the price, or take the listing off sale and put it back later.",
          "Update its details, tags and demo link.",
          "Publish new files. The new hash is recorded on chain, and buyers get the update.",
        ]}
      />

      <H2>Featuring</H2>
      <P>
        Pay to feature a listing for 1 to 90 days, in the listing&apos;s currency, at a daily rate
        set in the contract, to give it prominent placement in the Marketplace. Featuring a listing
        that is already featured extends it from the current end date.
      </P>

      <Callout tone="tip">
        Listings count towards your achievements: Seller, First sale, Top seller, Adopted and
        Appreciated. Templates other people deploy also raise your tier.
      </Callout>
    </DocPage>
  );
}
