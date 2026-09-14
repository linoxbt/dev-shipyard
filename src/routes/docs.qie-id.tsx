import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import {
  DocPage,
  H2,
  P,
  Bullets,
  Steps,
  Table,
  Callout,
  C,
  ExternalLink,
  DocLink,
} from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/qie-id")({
  head: () => ({ meta: [{ title: "QIE ID · DevStation Docs" }] }),
  component: QieIdDocs,
});

function QieIdDocs() {
  return (
    <DocPage
      title="QIE ID"
      icon={Fingerprint}
      intro="QIE ID gives a wallet a readable .qie name. DevStation shows a builder by their name wherever it can, and only when the chain says the wallet owns it right now."
    >
      <H2>Get a name</H2>
      <Steps
        steps={[
          {
            title: "Register it",
            body: (
              <P>
                Go to{" "}
                <ExternalLink href="https://domains.qie.digital/">domains.qie.digital</ExternalLink>
                , connect the wallet you build with, and register a name on QIE Mainnet.
              </P>
            ),
          },
          {
            title: "Open DevStation",
            body: (
              <P>
                Connect the same wallet. Your name appears on your dashboard, your public profile
                and the leaderboard. There is nothing to link or confirm.
              </P>
            ),
          },
        ]}
      />

      <H2>How DevStation reads it</H2>
      <P>
        QIE ID is an ERC-721 collection on QIE Mainnet: each name is a token. The contract proves
        which tokens a wallet holds, and the registration that minted each token carries its name.
        DevStation reads both.
      </P>
      <Bullets
        items={[
          "A name is shown only if the QIE ID contract says the wallet owns its token now.",
          "A name you sell or transfer away disappears from your profile.",
          "A name you receive by transfer shows, just like one you registered.",
          "The free, randomly generated name QIE gives some new wallets is not shown or counted: only a name somebody registered is an identity.",
          "Names are always read from QIE Mainnet, whichever network is selected in the console.",
          "A wallet with many names shows the correct total, with up to 24 of them listed.",
        ]}
      />

      <H2>Where names appear</H2>
      <Table
        head={["Place", "What you see"]}
        rows={[
          ["Builder dashboard", "Your names, and the one used as your display name."],
          ["Public profile", "The name as the page title, instead of the address."],
          ["Leaderboard", "Builders shown by name."],
          [
            "Achievements",
            <>
              Holding a name earns <C>Named</C>.
            </>,
          ],
        ]}
      />

      <H2>Gate a contract on QIE ID</H2>
      <P>
        The built-in <C>QieIdGatedAllowlist</C> template lets only wallets that hold a QIE ID claim
        from it. Deploy it from <DocLink to="/docs/launchkit">Deploy a Contract</DocLink>, passing
        the QIE ID contract as the gate token.
      </P>

      <Table
        head={["Contract", "Address (QIE Mainnet)"]}
        rows={[
          ["QIE ID (ERC-721)", "0x9aab56e7727af53A3131985BFB16d845319b7bdc"],
          ["Registrar", "0x1d69d75ad7b77b91c3760f84fac52e651710f62e"],
        ]}
      />

      <Callout>
        QIE ID is a name, not a score. Reputation in DevStation, such as tiers and achievements, is
        DevStation&apos;s own and comes only from what a wallet did on chain.
      </Callout>
    </DocPage>
  );
}
