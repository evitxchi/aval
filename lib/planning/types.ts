export const ITEM_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "completed",
] as const;
export const PROJECT_COLORS = [
  "blue",
  "green",
  "amber",
  "violet",
  "rose",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ProjectColor = (typeof PROJECT_COLORS)[number];
export interface Project {
  id: string;
  title: string;
  description: string;
  color: ProjectColor;
  createdAt: number;
}
export interface PlanningItem {
  id: string;
  title: string;
  description: string;
  kind: "task" | "event";
  status: ItemStatus;
  projectId: string | null;
  assigneeId: string | null;
  startsAt: number;
  endsAt: number;
  version: number;
}
export type ItemInput = Omit<PlanningItem, "id" | "version">;
export interface PlanningMember {
  userId: string;
  displayName: string;
  email: string;
  role: string;
}
export interface PlanningData {
  projects: Project[];
  items: PlanningItem[];
  members: PlanningMember[];
}
export function parseItem(input: unknown): ItemInput | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  if (
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.trim().length > 160 ||
    typeof v.description !== "string" ||
    v.description.length > 5000
  )
    return null;
  if (v.kind !== "task" && v.kind !== "event") return null;
  if (!ITEM_STATUSES.includes(v.status as ItemStatus)) return null;
  if (
    typeof v.startsAt !== "number" ||
    typeof v.endsAt !== "number" ||
    !Number.isSafeInteger(v.startsAt) ||
    !Number.isSafeInteger(v.endsAt) ||
    v.startsAt < 0 ||
    v.endsAt < v.startsAt ||
    v.endsAt > 7258118400000
  )
    return null;
  for (const id of [v.projectId, v.assigneeId])
    if (id !== null && (typeof id !== "string" || !id || id.length > 150))
      return null;
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    kind: v.kind,
    status: v.status as ItemStatus,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    projectId: v.projectId as string | null,
    assigneeId: v.assigneeId as string | null,
  };
}
/** Inclusive date-window overlap for calendar and timeline views. */
export function overlapsWindow(
  item: Pick<PlanningItem, "startsAt" | "endsAt">,
  start: number,
  end: number,
) {
  return item.startsAt <= end && item.endsAt >= start;
}
