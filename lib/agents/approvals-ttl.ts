/**
 * How long an approval request stays decidable.
 *
 * Its own module because approvals.ts imports the storage layer, and this
 * value is worth asserting in a test: too short and a request expires while
 * the approver is asleep, too long and a decision gets made against evidence
 * that has stopped being true.
 */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
