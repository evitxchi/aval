/**
 * When a subscription is due.
 *
 * A deliberately small schedule vocabulary rather than cron. Cron would be
 * more expressive and would also invite subscriptions nobody can reason about
 * ("why did this fire at 4am on the 31st?"), and the two shipped triggers need
 * exactly two shapes: a weekly digest at a fixed local hour, and a threshold
 * check a few times a day.
 *
 * Supported:
 *   `daily@HH`        — once a day at local hour HH
 *   `weekly@DOW:HH`   — once a week, DOW 0=Sunday
 *   `every@N`         — every N hours
 *
 * Timezones are handled with `Intl`, not by adding an offset. A fixed offset
 * is wrong twice a year in every zone that observes daylight saving, and
 * "Monday 08:00" landing at 07:00 for half the year is exactly the kind of
 * quiet wrongness nobody reports and everybody notices.
 */

/** Local wall-clock parts for an instant in a named zone. */
export function localParts(now: Date, timezone: string): { hour: number; weekday: number; day: string } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // An unknown zone falls back to UTC rather than throwing. A subscription
    // with a typo in its timezone should fire at a slightly wrong hour, not
    // stop firing and take its whole worker batch down with it.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    // `hour: numeric` with hour12:false yields "24" at midnight in some ICU
    // versions rather than "0". Normalising here rather than at each call site.
    hour: Number(parts.hour) % 24,
    weekday: weekdays.indexOf(String(parts.weekday)),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Whether this subscription should fire now.
 *
 * `lastFiredAt` is the guard against firing repeatedly inside the matching
 * hour: a one-minute cron sees the same 08:00 hour sixty times. Comparing on
 * the *local day* rather than on elapsed hours is what makes a daily schedule
 * fire once per calendar day even across a daylight-saving transition, when
 * "24 hours later" and "tomorrow at 08:00" are not the same instant.
 */
export function isDue(schedule: string, timezone: string, lastFiredAt: Date | null, now: Date): boolean {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;

  const current = localParts(now, timezone);

  if (parsed.kind === "every") {
    if (!lastFiredAt) return true;
    return now.getTime() - lastFiredAt.getTime() >= parsed.hours * 3_600_000;
  }

  if (current.hour !== parsed.hour) return false;
  if (parsed.kind === "weekly" && current.weekday !== parsed.weekday) return false;

  // Already fired on this local day.
  if (lastFiredAt && localParts(lastFiredAt, timezone).day === current.day) return false;

  return true;
}

type ParsedSchedule =
  | { kind: "daily"; hour: number }
  | { kind: "weekly"; weekday: number; hour: number }
  | { kind: "every"; hours: number };

/** Returns null for anything unrecognised, which means the subscription never fires. */
export function parseSchedule(schedule: string): ParsedSchedule | null {
  const daily = /^daily@(\d{1,2})$/.exec(schedule);
  if (daily) {
    const hour = Number(daily[1]);
    return hour >= 0 && hour <= 23 ? { kind: "daily", hour } : null;
  }

  const weekly = /^weekly@(\d):(\d{1,2})$/.exec(schedule);
  if (weekly) {
    const weekday = Number(weekly[1]);
    const hour = Number(weekly[2]);
    return weekday >= 0 && weekday <= 6 && hour >= 0 && hour <= 23 ? { kind: "weekly", weekday, hour } : null;
  }

  const every = /^every@(\d{1,3})$/.exec(schedule);
  if (every) {
    const hours = Number(every[1]);
    return hours >= 1 && hours <= 168 ? { kind: "every", hours } : null;
  }

  return null;
}
