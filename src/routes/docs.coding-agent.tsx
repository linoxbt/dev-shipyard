import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import {
  DocPage,
  H2,
  H3,
  P,
  Bullets,
  Steps,
  Table,
  Callout,
  Code,
  C,
  DocLink,
} from "@/components/docs/primitives";

// How DevStation works, as the live app does it today: signing in, the
// agent, the preview, templates, connected accounts, publishing, credits and
// the account. Kept in step with the app (components/coding-agent and the
// /publish, /connections, /credits and /account pages).

export const Route = createFileRoute("/docs/coding-agent")({
  head: () => ({ meta: [{ title: "How DevStation works · DevStation Docs" }] }),
  component: CodingAgentDocs,
});

const SECTIONS: [string, string][] = [
  ["get-started", "Get started"],
  ["working-with-the-agent", "Working with the agent"],
  ["preview-code-and-activity", "Preview, code and activity"],
  ["templates", "Templates"],
  ["connected-accounts", "Connected accounts"],
  ["publish-your-app", "Publish your app"],
  ["github-and-sharing", "GitHub and sharing"],
  ["credits-and-plans", "Credits and plans"],
  ["your-account", "Your account"],
  ["limits", "Limits"],
  ["the-cli", "The same agent in your terminal"],
];

function Contents() {
  return (
    <nav
      aria-label="On this page"
      className="rounded-xl border border-border bg-surface px-5 py-4 text-[14.5px]"
    >
      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        On this page
      </p>
      <ol className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {SECTIONS.map(([id, label], i) => (
          <li key={id} className="flex gap-2">
            <span className="w-5 shrink-0 text-right font-mono text-[12.5px] text-muted-foreground">
              {i + 1}.
            </span>
            <a href={`#${id}`} className="text-foreground hover:text-primary hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CodingAgentDocs() {
  return (
    <DocPage
      title="How DevStation works"
      icon={Bot}
      intro="Describe the app you want and DevStation's agent builds it: it writes the code, runs it on a machine of its own, checks its work and shows you the result live. When you are happy, publish it at an address of its own in one step."
    >
      <Contents />

      <H2 id="get-started">Get started</H2>
      <Steps
        steps={[
          {
            title: "Sign in with your email",
            body: (
              <P>
                Enter your email and type the code we send you. There is no password to remember.
                Your projects, credit and connected accounts belong to that email, on every device.
              </P>
            ),
          },
          {
            title: "Describe what you want",
            body: (
              <P>
                Type it in the box on the home screen, for example &ldquo;a habit tracker with
                streaks and a weekly chart&rdquo;. You can attach screenshots or designs with the{" "}
                <C>+</C> button, paste a picture, drop files in, or dictate with the microphone.
              </P>
            ),
          },
          {
            title: "Or start from something",
            body: (
              <Table
                head={["Start from", "What happens"]}
                rows={[
                  [
                    "A blank project",
                    "The agent starts from nothing and builds what you describe.",
                  ],
                  [
                    "A template",
                    "A finished, working app becomes your own project, ready to change. See Templates.",
                  ],
                  [
                    "Your files",
                    "Add a folder or files. Text files are copied in; dependencies, build output and binaries are left out.",
                  ],
                  [
                    "A GitHub repository",
                    "Any public repository by owner/name or URL. Private ones work once GitHub is connected.",
                  ],
                ]}
              />
            ),
          },
        ]}
      />

      <H2 id="working-with-the-agent">Working with the agent</H2>
      <P>
        Every message continues in the same project, and the agent remembers the conversation. Ask
        for changes the way you would ask a developer: &ldquo;make the header sticky&rdquo;,
        &ldquo;add a dark mode&rdquo;, &ldquo;the save button does nothing, fix it&rdquo;.
      </P>

      <H3>Build and Plan</H3>
      <Table
        head={["Mode", "What it does"]}
        rows={[
          ["Build", "Starts building straight away. The default."],
          [
            "Plan",
            "Writes a plan first and waits for you. Use it for a large change you want to agree on before any code is written.",
          ],
        ]}
      />

      <H3>Models</H3>
      <P>
        The model picker beside the mode sets which model does the work. <C>Auto</C> is Qwen 3.8
        27B, which is free every day up to an allowance (see Credits and plans). Other models, such
        as Claude, GPT and Gemini, are paid from credit or included with Pro.
      </P>

      <H3>What you see while it works</H3>
      <Bullets
        items={[
          "A live status line says what it is doing right now: thinking, writing a file, running a command, and for how long.",
          "Its replies read like a conversation. The steps between them (files read and written, commands run) fold into short lines such as “Ran 4 commands”; open one to see exactly what ran and what it printed.",
          "Files it changed appear as chips under its reply. Click one to open it.",
          "When it needs a decision from you, it asks with clear choices instead of guessing.",
        ]}
      />

      <H3>Send more while it works</H3>
      <P>
        You do not have to wait. A message sent during a turn joins a queue and runs as soon as the
        current one ends. Queued messages show above the box; remove one before it starts if you
        change your mind. Stop ends the current turn.
      </P>

      <Callout title="It keeps going when you leave">
        The agent works on DevStation&apos;s machines, not in your browser. Close the tab, lock your
        phone or switch devices, and it carries on with everything you asked for. Come back and the
        conversation shows what it did while you were away.
      </Callout>

      <H3>What it can do</H3>
      <Bullets
        items={[
          "Read, write and edit any file in the project.",
          "Run commands: install packages, build, lint and run tests.",
          "Take screenshots of the running app to check its own work on desktop and phone sizes.",
          "Search the web and read documentation.",
          "Use the accounts you connected (Netlify, Vercel, GitHub, Railway, Supabase) when you ask it to.",
        ]}
      />

      <H2 id="preview-code-and-activity">Preview, code and activity</H2>
      <Table
        head={["View", "Shows"]}
        rows={[
          [
            "Preview",
            "Your app running, updated as the agent builds. Switch between desktop, tablet and phone widths. While the first build runs, a progress view shows each stage it goes through.",
          ],
          [
            "Code",
            "Every file in the project as a tree, with syntax highlighting. Files changed in the last turn are marked.",
          ],
          ["Activity", "Each command and edit with its output, and what the work has cost so far."],
        ]}
      />
      <P>
        On a phone, the tabs along the bottom switch between the chat, the preview and the activity.
        The menu at the top left lists your projects and starts a new one. The <C>•••</C> button
        holds everything you can do with the open project: share, push to GitHub, download as a zip,
        remix into a copy, rename or delete.
      </P>

      <H2 id="templates">Templates</H2>
      <P>
        The Templates tab on the home screen holds finished, working apps. Open one and it becomes
        your own project, with its preview already running; ask the agent to change anything.
      </P>
      <Bullets
        items={[
          "Built-in templates: a wallet, a task board, an expense tracker, a landing page, a focus timer and a mint page.",
          "Community templates: apps people built on DevStation, picked by the DevStation team. They carry a Community label and appear first.",
        ]}
      />
      <P>
        A community template is a copy of the app&apos;s files and build. It never includes the
        builder&apos;s conversation, environment files or anything private.
      </P>

      <H2 id="connected-accounts">Connected accounts</H2>
      <P>
        Open <C>Connected accounts</C> from your account to link Netlify, Vercel, GitHub, Railway
        and Supabase. Each one is connected with that service&apos;s own sign-in; DevStation never
        sees your passwords.
      </P>
      <P>
        Once connected, the agent can use them in your projects, for example &ldquo;deploy this to
        my Netlify&rdquo; or &ldquo;create a Supabase table for the scores&rdquo;. In a project
        shared with other builders, your accounts stay yours: the agent is told they exist but does
        not use them for anyone else. Disconnect an account at any time from the same page.
      </P>

      <H2 id="publish-your-app">Publish your app</H2>
      <P>
        Press the rocket at the top of a project to open the Publish page. Publishing on DevStation
        is free.
      </P>
      <Steps
        steps={[
          {
            title: "Choose its address",
            body: (
              <P>
                Pick a name and your app goes live at <C>&lt;name&gt;.devstation.online</C>. The
                page tells you as you type whether the name is free.
              </P>
            ),
          },
          {
            title: "Publish",
            body: (
              <P>
                DevStation uploads the latest build and then opens the address the way a visitor
                would, to confirm it shows the new version. If it does not yet, the page says why
                (the name does not resolve, it points somewhere else, its certificate is not ready,
                or the previous version is still showing) and keeps checking until it is live.
              </P>
            ),
          },
          {
            title: "Publish again after changes",
            body: (
              <P>
                Press <C>Publish latest</C> whenever you want the live app to catch up with your
                project. The address stays the same.
              </P>
            ),
          },
        ]}
      />

      <H3>Use your own domain</H3>
      <Steps
        steps={[
          {
            title: "Add the domain",
            body: (
              <P>
                Under Your own domain, enter it, for example <C>app.yourdomain.com</C>.
              </P>
            ),
          },
          {
            title: "Create the DNS records shown",
            body: (
              <P>
                The page lists the records to add where your domain is managed: a CNAME for a
                subdomain, or an A record for a root domain, plus a TXT record if verification is
                needed.
              </P>
            ),
          },
          {
            title: "Check again",
            body: (
              <P>
                DNS changes can take from a few minutes to an hour. Once the records are in place,
                the domain shows as Live and the same reachability check confirms it opens your app.
              </P>
            ),
          },
        ]}
      />
      <P>
        Prefer your own hosting? <C>Deploy to your own hosting</C> on the same page asks the agent
        to deploy to the Netlify or Vercel account you connected. Unpublish takes a DevStation site
        down; the project itself is untouched.
      </P>

      <H2 id="github-and-sharing">GitHub and sharing</H2>
      <Table
        head={["Action", "What it does"]}
        rows={[
          [
            "Push to GitHub",
            "Creates a repository in your GitHub account with the project's files.",
          ],
          [
            "Open a pull request",
            "For a project that started from a repository: puts the changes on a branch and opens a pull request against it.",
          ],
          [
            "Share",
            "Invite builders by the email they sign in with, then send them the invite link. They work in the same project with the same agent.",
          ],
          ["Download as zip", "Every file of the project, to run or keep anywhere."],
        ]}
      />
      <Callout title="Nothing reaches GitHub without you">
        The agent never holds your GitHub credentials. Pushing and opening pull requests happen only
        when you press the button, with your own account.
      </Callout>

      <H2 id="credits-and-plans">Credits and plans</H2>
      <P>
        The Plan, credits and usage page shows your balance, today&apos;s free allowance, your plan
        and what you used, day by day and per model.
      </P>
      <Table
        head={["Plan", "How it works"]}
        rows={[
          [
            "Free",
            "Qwen 3.8 27B (Auto) is free every day up to an allowance, which resets at midnight UTC.",
          ],
          [
            "Pay as you go",
            "Add credit whenever you like. Any model is charged to credit at its price, and Auto is charged too once the day's free allowance is used.",
          ],
          [
            "Pro",
            "A monthly plan with credit included each month and a larger daily free allowance.",
          ],
        ]}
      />
      <P>
        Payments are handled by the payment provider on a secure checkout page; DevStation never
        sees your card. Manage billing on the same page opens your receipts and subscription.
      </P>

      <H2 id="your-account">Your account</H2>
      <Bullets
        items={[
          "Account: your email, plan, appearance (light or dark) and sign out.",
          "Updates: news about shared projects, such as another builder's work.",
          "Every project is saved to your account as you work, with its conversation, files and build. Sign in on another device and they are all there.",
          "Deleting a project removes it from every device. A copy on GitHub or a published app is not touched.",
        ]}
      />

      <H2 id="limits">Limits</H2>
      <Bullets
        items={[
          "A single turn stops after about 60 minutes or 150 steps; send another message to carry on.",
          "An import or upload can bring in up to 12 MB of text.",
          "A published app can be up to 80 MB.",
          "Project machines sleep when idle and are recreated from your saved files when you come back.",
        ]}
      />

      <H2 id="the-cli">The same agent in your terminal</H2>
      <P>For work on your own machine, with your own tools, install the CLI:</P>
      <Code code={`npm install -g @devstationlabs/cli\ndevstation`} />
      <P>
        See <DocLink to="/docs/cli/install">Install the CLI</DocLink>.
      </P>
    </DocPage>
  );
}
