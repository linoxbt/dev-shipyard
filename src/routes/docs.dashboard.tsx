import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Table,
  Callout,
  C,
  ConsoleLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/dashboard")({
  head: () => ({ meta: [{ title: "Builder Dashboard · DevStation Docs" }] }),
  component: DashboardDocs,
});

function DashboardDocs() {
  return (
    <DocPage
      title="Builder Dashboard"
      icon={LayoutDashboard}
      intro="Everything DevStation knows about a builder, across every network, in one place. Every figure is read from chain, so none of it can be typed in to look better."
    >
      <H2>Your dashboard and your profile</H2>
      <P>
        Connect a wallet and open <ConsoleLink to="/activity">Dashboard</ConsoleLink> in the
        sidebar. The same view, minus what only lives in your browser, is public at{" "}
        <C>/dev/&lt;address&gt;</C>. Share that link as your builder profile; the leaderboard links
        to it too.
      </P>
      <Table
        head={["", "Dashboard", "Public profile"]}
        rows={[
          ["Stats, activity, achievements", "Yes", "Yes"],
          ["Contracts by network", "Yes", "Yes"],
          ["Marketplace sales and earnings", "Yes", "Yes"],
          ["Published apps", "Yes", "Yes"],
          ["Apps you built but have not published", "Yes", "No, they are in your browser"],
          ["Withdraw earnings, manage listings", "Yes", "No"],
        ]}
      />

      <H2>What it shows</H2>
      <H3>Identity</H3>
      <P>
        Your <DocLink to="/docs/qie-id">.qie name</DocLink> if the wallet holds one, the
        wallet&apos;s age and first activity, and the networks it has built on.
      </P>
      <H3>Stats</H3>
      <Table
        head={["Stat", "Measured by"]}
        rows={[
          ["Contracts", "Deployments recorded in the ProjectRegistry, on every network."],
          ["Verified", "Of those, contracts whose source is verified on the explorer."],
          ["Earned", "Marketplace sales, per-deploy fees and tips paid to this wallet."],
          ["Sales", "Purchases and paid deploys of this wallet's listings."],
          ["Listings", "Listings this wallet published on the Marketplace."],
          ["Apps live", "Apps this wallet has published to a devstation.online address."],
          ["Labels", "Contract labels this wallet contributed to the Label Registry."],
          ["Transactions", "The wallet's transaction count on QIE Mainnet."],
        ]}
      />
      <H3>Activity</H3>
      <P>
        A year-long heatmap of the days you shipped something, your current and longest streaks, and
        a timeline of recent deployments, sales, purchases, tips and publishes. A streak survives
        until the end of the day, so not having shipped yet today does not break it.
      </P>
      <H3>Contracts, marketplace and apps</H3>
      <Bullets
        items={[
          "Every contract, grouped by network, with its template, transaction and verification status.",
          "Marketplace earnings, tips, what is waiting to be withdrawn, and what you have bought.",
          "Published apps with their live addresses, and the apps you are still building.",
          "Labels you contributed to the registry.",
        ]}
      />

      <H2>Standing</H2>
      <P>
        A builder&apos;s tier is weighted by their own deployments plus deployments other people
        made of their templates. Being adopted counts as much as shipping.
      </P>
      <Table
        head={["Tier", "Weight"]}
        rows={[
          ["Newcomer", "0"],
          ["Builder", "3"],
          ["Regular", "10"],
          ["Veteran", "25"],
        ]}
      />

      <H2>Achievements</H2>
      <P>
        Each achievement names the fact it is measured by. A locked one shows how far away it is.
      </P>
      <Table
        head={["Achievement", "How to earn it"]}
        rows={[
          ["First contract", "Deploy a contract on chain."],
          ["Shipper", "Deploy 10 contracts."],
          ["Veteran", "Deploy 25 contracts."],
          ["Multichain", "Deploy on 2 or more networks."],
          ["Range", "Deploy from 5 different templates."],
          ["App builder", "Build an app with the Coding Agent."],
          ["Live on the web", "Publish an app to devstation.online."],
          ["Verified", "Get a contract's source verified."],
          ["Open book", "Get 10 contracts verified."],
          ["On a roll", "Stay active 7 days in a row."],
          ["Seller", "List something in the Marketplace."],
          ["First sale", "Make a sale."],
          ["Top seller", "Make 25 sales."],
          ["Adopted", "Have others deploy your templates 10 times."],
          ["Appreciated", "Receive a tip."],
          ["Labeler", "Label 5 contracts in the registry."],
          ["Top 10", "Reach the top 10 of the leaderboard."],
          ["Named", "Hold a .qie name."],
          ["OG", "Use a wallet that is a year old."],
        ]}
      />

      <Callout>
        Parts of a dashboard come from different sources: the registries, the Marketplace contract,
        each network&apos;s explorer and the app host. If one cannot be reached, that section says
        so and the rest still loads.
      </Callout>
    </DocPage>
  );
}
