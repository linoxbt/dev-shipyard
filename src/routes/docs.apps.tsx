import { createFileRoute } from "@tanstack/react-router";
import { AppWindow } from "lucide-react";
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

export const Route = createFileRoute("/docs/apps")({
  head: () => ({ meta: [{ title: "Apps & Publishing · DevStation Docs" }] }),
  component: AppsDocs,
});

function AppsDocs() {
  return (
    <DocPage
      title="Apps & Publishing"
      icon={AppWindow}
      intro="Every app you build with the Coding Agent is kept, named and reopenable. Publish one and it is live on the web at its own devstation.online address."
    >
      <H2>Your apps</H2>
      <P>
        Your apps are listed on your <ConsoleLink to="/activity">dashboard</ConsoleLink> and at{" "}
        <ConsoleLink to="/launchkit/apps">Apps</ConsoleLink>. From the list you can rename an app or
        open it back in the builder. Each app has its own page with:
      </P>
      <Bullets
        items={[
          "Its name, when it was last changed, and how many files it has.",
          "Where it is published, if it is.",
          "Where its source lives on GitHub, if you pushed it.",
          "The files themselves.",
        ]}
      />
      <Callout>
        Apps you are building are saved in this browser. Publish an app, push it to GitHub, or list
        it on the Marketplace to have a copy that lives somewhere else.
      </Callout>

      <H2>Publish an app</H2>
      <Steps
        steps={[
          { title: "Connect a wallet", body: "The site is owned by the wallet that publishes it." },
          {
            title: "Choose a name",
            body: (
              <P>
                The name becomes the address: <C>my-tip-jar</C> is published at{" "}
                <C>https://my-tip-jar.devstation.online</C>.
              </P>
            ),
          },
          {
            title: "Publish",
            body: "The files are uploaded and served over HTTPS within seconds. Publish again under the same name to update the site.",
          },
        ]}
      />

      <H3>Name rules</H3>
      <Bullets
        items={[
          "2 to 40 characters: lowercase letters, digits and hyphens. Anything else is turned into a hyphen.",
          "Not only digits.",
          "Not a reserved name. Names DevStation uses or may need, such as www, api, app, docs, explorer, dashboard, status and build, cannot be taken.",
          "Only the wallet that first published a name can publish to it again, so a shared link cannot be taken over.",
        ]}
      />

      <H3>Limits</H3>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["Files per site", "200"],
          ["Total size", "10 MB"],
          ["Publishes", "Rate limited per wallet and per connection"],
        ]}
      />

      <H2>Push to GitHub</H2>
      <P>
        From the builder or the app&apos;s page, push the files to a GitHub repository. Connect
        GitHub once, pick or name a repository, and the app&apos;s files are committed to it.
      </P>

      <H2>Sell an app</H2>
      <P>
        Apps can be listed on the Marketplace straight from the Sell page: choose an app you built
        and it is packaged for you. Buyers get the files as a new app in their own builder. See{" "}
        <DocLink to="/docs/selling">Selling &amp; Earnings</DocLink>.
      </P>
    </DocPage>
  );
}
