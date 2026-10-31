// Finished apps offered on the Templates tab. Each one is a complete,
// working single-file app: tapping it makes a project from its files and
// opens the preview, and the agent can carry on building from there.

import expenses from "./app-templates/expenses.html?raw";
import flowWallet from "./app-templates/flow-wallet.html?raw";
import focusTimer from "./app-templates/focus-timer.html?raw";
import kanban from "./app-templates/kanban.html?raw";
import landing from "./app-templates/landing.html?raw";
import nftMint from "./app-templates/nft-mint.html?raw";

export type AppTemplate = {
  id: string;
  name: string;
  blurb: string;
  html: string;
};

export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: "flow-wallet",
    name: "Flow wallet",
    blurb: "A stablecoin wallet with balances, send and receive, and activity.",
    html: flowWallet,
  },
  {
    id: "kanban",
    name: "Taskboard",
    blurb: "A drag-and-drop kanban board with priorities, saved as you go.",
    html: kanban,
  },
  {
    id: "expenses",
    name: "Spendwise",
    blurb: "An expense tracker with monthly totals and a breakdown by category.",
    html: expenses,
  },
  {
    id: "landing",
    name: "Northwind landing page",
    blurb: "A product landing page with signup, pricing toggle and FAQ.",
    html: landing,
  },
  {
    id: "focus-timer",
    name: "Focus timer",
    blurb: "A Pomodoro timer with a progress ring, breaks and settings.",
    html: focusTimer,
  },
  {
    id: "nft-mint",
    name: "Prism mint page",
    blurb: "A generative-art mint page with live supply and your collection.",
    html: nftMint,
  },
];

/** The files a project made from a template starts with. */
export function templateFiles(t: AppTemplate): Record<string, string> {
  return {
    "index.html": t.html,
    "README.md": `# ${t.name}\n\n${t.blurb}\n\nA single-file app: everything lives in \`index.html\`, with no build step. Open it in a browser to run it.\n`,
  };
}
