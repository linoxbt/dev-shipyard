import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { DocPage, H2, H3, P, Code, Callout, C, Table, Bullets } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/cli/sessions")({
  head: () => ({ meta: [{ title: "Sessions & Commands · DevStation CLI" }] }),
  component: CliSessions,
});

function CliSessions() {
  return (
    <DocPage
      title="Sessions & Commands"
      icon={MessagesSquare}
      intro="Talk to it in a session, give it one job from a script, or point it at a GitHub repository. Every run is saved as it goes, so nothing is lost if it stops."
    >
      <H2>A session</H2>
      <Code code={`cd your-project\ndevstation`} />
      <P>
        <C>devstation</C> clears the terminal and opens its own session. A rule above each prompt
        shows the model, the folder and any mode that is on. Say what you want; the conversation
        carries across turns, so the second thing you ask can be about the first.
      </P>
      <Table
        head={["Key", "Does"]}
        rows={[
          ["/ then Tab", "Complete a slash command."],
          ["Ctrl-C", "Interrupt the turn in progress."],
          ["Ctrl-D or /exit", "Leave the session."],
        ]}
      />

      <H2>One job and out</H2>
      <Code
        code={`devstation run "fix the failing test in src/total.test.js, change the source not the test"`}
      />
      <P>
        Good for scripts. Combine with <C>--budget</C> and <C>--max-steps</C> to bound what it can
        spend, and <C>-y</C> to approve gated actions for that run.
      </P>

      <H2>A GitHub repository</H2>
      <Code
        code={`export GITHUB_TOKEN=$(gh auth token)
devstation repo owner/name "add a Usage section to the README"`}
      />
      <P>
        It clones the repository into <C>.devstation/repos/</C>, does the work, and finishes by
        proposing a pull request that you approve. The token needs push rights to the repository.
      </P>

      <H2>Watch, resume, list</H2>
      <Code
        code={`devstation status -f                                  # follow the live run from another terminal
devstation resume                                     # the last run in this workspace
devstation resume <id> "actually, use the existing helper"
devstation sessions                                   # every run in this workspace`}
      />

      <H2>Modes and shortcuts</H2>
      <Table
        head={["Key", "Does"]}
        rows={[
          [
            "/",
            "Show every command under the prompt. Keep typing to narrow the list; Tab completes.",
          ],
          [
            "Shift+Tab",
            "Switch mode: normal, then auto mode, then plan mode, then back. The rule above the prompt shows which is on.",
          ],
          [
            "↑ / ↓ and Enter",
            "Choose an answer when the agent asks for permission or a plan is ready.",
          ],
          ["Ctrl-C", "Interrupt the turn in progress."],
        ]}
      />
      <Table
        head={["Mode", "What happens"]}
        rows={[
          ["Normal", "Ordinary work runs; anything that changes things outside it asks first."],
          [
            "Auto mode",
            "Actions run without asking. Critical ones still ask. The same as /approve on.",
          ],
          [
            "Plan mode",
            "It reads, searches and looks things up, changes nothing, and ends with a plan to approve. The same as /plan on.",
          ],
        ]}
      />
      <H3>Plans</H3>
      <P>
        For work with several steps the agent keeps a checklist, shown as it goes: ✔ done, ◐ in
        progress, □ still to do. In plan mode it ends with that checklist and asks whether to carry
        it out; choose Yes and it starts, choose No and it keeps planning.
      </P>

      <H2>Slash commands</H2>
      <Table
        head={["Command", "What it does"]}
        rows={[
          ["/new", "Start a fresh conversation in the same workspace. Also /clear."],
          ["/resume [id]", "Pick up an earlier conversation, from a numbered list."],
          ["/rename <title>", "Name this conversation."],
          ["/archive [id]", "Hide a conversation from the list. /resume <id> still opens it."],
          ["/delete [id]", "Delete a conversation for good, after asking."],
          ["/sessions", "List conversations in this workspace."],
          ["/model [name]", "Show the model, or switch it for this session."],
          ["/plan [on|off]", "Plan mode: read, search and propose; change nothing."],
          ["/approve [on|off]", "Run every gated action without asking, for this session."],
          ["/skill [name] [task]", "List skills, or run one. Also /<name>."],
          ["/usage", "Tokens and cost of this conversation. Also /cost."],
          ["/status /diff /undo /checkpoints", "The same as the commands of those names."],
          ["/tools /mcp /memory /index /config", "The same as the commands of those names."],
          ["/doctor /login /logout /upgrade", "The same as the commands of those names."],
          ["/help /exit", "Show the commands, or leave."],
        ]}
      />

      <H2>Plan mode</H2>
      <P>
        With <C>/plan on</C>, the agent may read files, search, run read-only commands and look
        things up on the web. Edits, installs, commits and anything with side effects are refused.
        It ends with a numbered plan and asks <C>Carry out this plan?</C>. Answer <C>y</C> and plan
        mode turns off and the work starts.
      </P>
      <Callout tone="tip">
        Use plan mode for anything larger than a small fix. Reading the plan first is the cheapest
        moment to change direction.
      </Callout>

      <H2>Skills</H2>
      <P>Skills are Markdown files of instructions you want reused:</P>
      <Code
        language="text"
        code={`.devstation/skills/<name>.md          this project
.devstation/skills/<name>/SKILL.md    the same, as a folder
~/.devstation/skills/<name>.md        every project`}
      />
      <P>
        Skills in <C>.claude/skills</C> and <C>~/.claude/skills</C> are read too, so skills written
        for Claude Code work unchanged. Optional frontmatter gives a <C>name</C> and a{" "}
        <C>description</C>. Run one with <C>/&lt;name&gt; what to use it on</C>.
      </P>
      <Code
        language="markdown"
        code={`---
name: release-notes
description: Draft release notes from the commits since the last tag
---

Read \`git log\` since the latest tag. Group changes into Added, Changed and Fixed.
Write for users, not for developers: say what changed for them, not which file.`}
      />
      <H3>Skills from the Marketplace</H3>
      <Bullets
        items={[
          "Agent skills bought on the DevStation Marketplace are ordinary skill files.",
          "Put them in .devstation/skills/ for one project, or ~/.devstation/skills/ for all of them.",
        ]}
      />
    </DocPage>
  );
}
