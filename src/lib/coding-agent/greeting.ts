// The home screen's greeting, the way Claude greets you: it follows the time
// of day and the day of the week, notices when you come back, and changes
// from visit to visit instead of saying the same thing every time.

export interface Greeting {
  /** "Good evening, Maya" (without its closing mark). */
  hello: string;
  /** The closing mark, shown in the brand colour: "." or "?". */
  mark: "." | "?";
  /** The line under it: "What will you build tonight?" */
  ask: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Pick a greeting for `name` (null when we do not know it) at `now`.
 * `returning` is true once the person has projects here; `roll` (0 to 1)
 * chooses among the fitting options, so each visit can read differently.
 */
export function greeting(
  name: string | null,
  now: Date,
  { returning = false, roll = Math.random() }: { returning?: boolean; roll?: number } = {},
): Greeting {
  const hour = now.getHours();
  const day = now.getDay();
  const weekend = day === 0 || day === 6;
  const to = (s: string) => (name ? `${s}, ${name}` : s);
  const pick = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(roll * list.length))];

  type Option = { hello: string; mark?: "." | "?" };
  const options: Option[] = [];
  let when: "morning" | "afternoon" | "evening" | "night";

  if (hour >= 5 && hour < 12) {
    when = "morning";
    options.push({ hello: to("Good morning") }, { hello: to("Morning") });
    if (day === 1) options.push({ hello: to("Happy Monday") });
  } else if (hour >= 12 && hour < 17) {
    when = "afternoon";
    options.push({ hello: to("Good afternoon") });
    if (day === 5) options.push({ hello: to("Happy Friday") });
  } else if (hour >= 17 && hour < 22) {
    when = "evening";
    options.push({ hello: to("Good evening") }, { hello: to("Evening") });
    if (day === 5) options.push({ hello: to("Happy Friday") });
  } else {
    when = "night";
    // The long one only when it still fits a phone on one or two lines.
    if (!name || name.length <= 8) {
      options.push({
        hello: name ? `Burning the midnight oil, ${name}` : "Burning the midnight oil",
        mark: "?",
      });
    }
    options.push({ hello: name ? `Up late, ${name}` : "Up late", mark: "?" });
  }
  if (weekend && when !== "night") options.push({ hello: to(`Happy ${DAYS[day]}`) });
  if (returning) options.push({ hello: to("Welcome back") });
  if (name) options.push({ hello: `Hi ${name}` }, { hello: `Hey ${name}` });

  const asks: Record<typeof when, string[]> = {
    morning: [
      "What will you build today?",
      "What are we building today?",
      "What will you build next?",
    ],
    afternoon: [
      "What will you build next?",
      "What are we building today?",
      "What's the next idea?",
    ],
    evening: ["What will you build tonight?", "What will you build next?", "What's the next idea?"],
    night: ["What will you build tonight?", "What's keeping you up?", "What will you build next?"],
  };
  const chosen = pick(options);
  // A second, independent pick for the line under it.
  const askRoll = (roll * 7.31) % 1;
  const asksFor = asks[when];
  return {
    hello: chosen.hello,
    mark: chosen.mark ?? ".",
    ask: asksFor[Math.min(asksFor.length - 1, Math.floor(askRoll * asksFor.length))],
  };
}
