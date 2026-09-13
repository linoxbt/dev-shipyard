import { createFileRoute } from "@tanstack/react-router";
import { Home } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Table,
  Callout,
  ConsoleLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/console")({
  head: () => ({ meta: [{ title: "Overview & Analytics · DevStation Docs" }] }),
  component: ConsoleDocs,
});

function ConsoleDocs() {
  return (
    <DocPage
      title="Overview & Analytics"
      icon={Home}
      intro="The pages that show the state of DevStation as a whole: the overview you land on, analytics for a network, the leaderboard, and the settings that shape the console."
    >
      <H2>Overview</H2>
      <P>
        The <ConsoleLink to="/overview">overview</ConsoleLink> is the console&apos;s front page. It
        reads everything before showing it, so a number is either real or clearly marked as
        unavailable, never a placeholder.
      </P>
      <Bullets
        items={[
          "Ecosystem totals: contracts deployed and builders, combined across every network, with the per-network breakdown.",
          "Network health for every supported chain: whether it is reachable, the latest block and gas price.",
          "The latest deployments made through DevStation, on every network.",
          "Your own work when a wallet is connected: your deployments, where they are recorded, and shortcuts to what you do most.",
          "Quick actions: deploy a template, open the editor, start the Coding Agent, or decode a transaction hash.",
        ]}
      />
      <Callout>
        If one network cannot be reached, the totals from the others are still shown and the page
        says which network is missing, rather than silently reporting a smaller number.
      </Callout>

      <H2>Analytics</H2>
      <P>
        <ConsoleLink to="/analytics">Analytics</ConsoleLink> charts deployment activity on the
        selected network: deployments over time, the templates people use, and how many distinct
        wallets are building. Switch networks in the sidebar to compare chains.
      </P>

      <H2>Leaderboard</H2>
      <P>
        The <ConsoleLink to="/leaderboard">leaderboard</ConsoleLink> ranks builders by contracts
        deployed through DevStation on the selected network.
      </P>
      <Bullets
        items={[
          "A rank is a count of successful recordDeployment transactions in the ProjectRegistry.",
          "Reverted transactions are excluded, so failed attempts cannot inflate anyone.",
          "Nothing on a profile can be edited to move up: the ranking is read from chain.",
          "Builders with a .qie name are shown by it. Click anyone to open their public profile.",
        ]}
      />
      <P>
        If the explorer that indexes the registry is unreachable, the leaderboard says so instead of
        showing a partial ranking.
      </P>

      <H2>Settings</H2>
      <Table
        head={["Section", "What it controls"]}
        rows={[
          [
            "Wallet & Profile",
            "Your connected wallet, and how long a DevStation wallet stays unlocked.",
          ],
          ["Network Configuration", "The active network, and the RPC and explorer it uses."],
          [
            "Contract Label Registry",
            "Whether contracts you deploy are labelled in the onchain registry automatically.",
          ],
          ["Display Preferences", "Address format and theme."],
          ["Clear Data", "Remove what DevStation keeps in this browser."],
        ]}
      />
      <H3>AI provider keys</H3>
      <P>
        Keys for Code with AI and the Coding Agent are set in the AI settings panel on the{" "}
        <ConsoleLink to="/launchkit/ai">Code with AI</ConsoleLink> page. See the Code with AI page
        of these docs for the providers and how keys are stored.
      </P>
    </DocPage>
  );
}
