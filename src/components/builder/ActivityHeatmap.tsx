import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { buildHeatmap } from "@/lib/builder/activity";

// A year of shipping at a glance, one square per day. Every square counts
// things that happened on chain or in the builder's own work that day.

const LEVEL = [
  "bg-surface-2",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ActivityHeatmap({ timestamps }: { timestamps: number[] }) {
  const map = useMemo(() => buildHeatmap(timestamps), [timestamps]);

  // Month labels over the first column that starts a new month.
  const labels = map.weeks.map((week, i) => {
    const month = new Date(week[0].date).getUTCMonth();
    const previous = i > 0 ? new Date(map.weeks[i - 1][0].date).getUTCMonth() : -1;
    return month !== previous ? MONTHS[month] : "";
  });

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[3px] pl-6 font-mono text-[9px] text-meta">
            {labels.map((label, i) => (
              <span key={i} className="w-[11px] overflow-visible whitespace-nowrap">
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-5 flex-col justify-between py-[2px] font-mono text-[9px] text-meta">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            {map.weeks.map((week, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <span
                    key={day.date}
                    title={
                      day.inRange
                        ? `${day.count} ${day.count === 1 ? "action" : "actions"} on ${new Date(day.date).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}`
                        : undefined
                    }
                    className={cn(
                      "h-[11px] w-[11px] rounded-[2px]",
                      day.inRange ? LEVEL[day.level] : "bg-transparent",
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] text-meta">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-foreground">{map.total}</span> actions in the last year
          </span>
          <span>
            <span className="text-foreground">{map.activeDays}</span> active days
          </span>
          <span>
            longest streak <span className="text-foreground">{map.longestStreak}d</span>
          </span>
          <span>
            current streak <span className="text-foreground">{map.currentStreak}d</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          less
          {LEVEL.map((cls, i) => (
            <span key={i} className={cn("h-[10px] w-[10px] rounded-[2px]", cls)} />
          ))}
          more
        </div>
      </div>
    </div>
  );
}
