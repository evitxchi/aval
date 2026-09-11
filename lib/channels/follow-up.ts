/**
 * Adaptive follow-up — our analogue of Deskcomm's "Radar".
 *
 * A conversation that was started and then went quiet is the most common way a
 * collection effort dies: nobody decided to stop, the thread just stopped. A
 * fixed reminder interval addresses that badly in both directions. Seven days
 * is nagging for someone who always replies within an hour, and far too slow
 * for someone who reliably takes three days and would have answered on day
 * four.
 *
 * So the interval adapts to the contact's own history. `N` is derived from how
 * long this person has actually taken to reply in the past, not from a policy
 * constant — which means the quiet-but-reliable resident is left alone and the
 * one who has never replied at all is escalated to a human sooner.
 *
 * Everything here is arithmetic over `messages` timestamps. No model call is
 * involved in deciding *whether* to follow up, for the same reason the
 * subscription gates are SQL: the decision is computable, and a model asked to
 * make it would be slower, costlier and less predictable.
 */

/** Nothing is chased sooner than this, however fast the contact usually is. */
export const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Nor later than this, however slow they usually are. A balance does not wait a month. */
export const MAX_INTERVAL_MS = 10 * 24 * 60 * 60 * 1000;

/** With no history at all, this is the assumption. */
export const DEFAULT_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/** After this many unanswered attempts, a person takes over. */
export const MAX_ATTEMPTS = 3;

export interface ResponseHistory {
  /** Milliseconds from each outbound message to the reply it got. */
  latencies: number[];
  /** Outbound messages that never got one. */
  unanswered: number;
}

/**
 * How long to wait before chasing, given a contact's history.
 *
 * Uses the **median** rather than the mean. Reply latency is a heavily skewed
 * distribution — most replies are quick, one arrived after a fortnight's
 * holiday — and a mean dragged upward by that one holiday would stop us ever
 * following up with someone who normally answers same-day.
 */
export function intervalFor(history: ResponseHistory): number {
  if (history.latencies.length === 0) return DEFAULT_INTERVAL_MS;

  const sorted = [...history.latencies].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

  // Wait their usual time plus half again, so a follow-up lands after they
  // would normally have replied rather than on top of the moment they were
  // about to.
  const adaptive = median * 1.5;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, adaptive));
}

/**
 * Reply latencies and misses from an ordered message list.
 *
 * A latency is counted from the *first* outbound message of a run to the reply
 * that followed it. Counting from the last would measure how long someone took
 * after being chased twice, which is a fact about our nagging rather than
 * about them.
 */
export function historyFrom(rows: { direction: string; createdAt: Date }[]): ResponseHistory {
  const latencies: number[] = [];
  let unanswered = 0;
  let runStart: Date | null = null;

  for (const row of rows) {
    if (row.direction === "outbound") {
      if (runStart === null) runStart = row.createdAt;
      continue;
    }
    if (runStart !== null) {
      latencies.push(row.createdAt.getTime() - runStart.getTime());
      runStart = null;
    }
  }

  // A run still open at the end of the thread is an outstanding question.
  if (runStart !== null) unanswered = 1;

  return { latencies, unanswered };
}
