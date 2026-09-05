import { env } from "cloudflare:workers";
import type { ItemInput, PlanningItem, Project, ProjectColor } from "./types";
const db = () => (env as unknown as { DB: D1Database }).DB;
const fields =
  "id, title, description, kind, status, project_id AS projectId, assignee_id AS assigneeId, starts_at AS startsAt, ends_at AS endsAt, version";
export async function readPlanning(organizationId: string) {
  const [projects, items] = await Promise.all([
    db()
      .prepare(
        "SELECT id,title,description,color,created_at AS createdAt FROM planning_projects WHERE organization_id = ? ORDER BY created_at DESC",
      )
      .bind(organizationId)
      .all<Project>(),
    db()
      .prepare(
        `SELECT ${fields} FROM planning_items WHERE organization_id = ? ORDER BY starts_at,id`,
      )
      .bind(organizationId)
      .all<PlanningItem>(),
  ]);
  return { projects: projects.results, items: items.results };
}
export async function hasProject(organizationId: string, id: string) {
  return Boolean(
    await db()
      .prepare(
        "SELECT id FROM planning_projects WHERE organization_id = ? AND id = ?",
      )
      .bind(organizationId, id)
      .first(),
  );
}
export async function createProject(
  organizationId: string,
  title: string,
  description: string,
  color: ProjectColor,
) {
  const row = {
    id: crypto.randomUUID(),
    title,
    description,
    color,
    createdAt: Date.now(),
  };
  await db()
    .prepare(
      "INSERT INTO planning_projects (id,organization_id,title,description,color,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(row.id, organizationId, title, description, color, row.createdAt)
    .run();
  return row;
}
export async function createItem(
  organizationId: string,
  createdBy: string,
  input: ItemInput,
) {
  const row = { ...input, id: crypto.randomUUID(), version: 1 };
  await db()
    .prepare(
      "INSERT INTO planning_items (id,organization_id,title,description,kind,status,project_id,assignee_id,starts_at,ends_at,version,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      row.id,
      organizationId,
      row.title,
      row.description,
      row.kind,
      row.status,
      row.projectId,
      row.assigneeId,
      row.startsAt,
      row.endsAt,
      1,
      createdBy,
      Date.now(),
    )
    .run();
  return row;
}
export async function updateItem(
  organizationId: string,
  id: string,
  version: number,
  input: ItemInput,
) {
  const result = await db()
    .prepare(
      "UPDATE planning_items SET title=?,description=?,kind=?,status=?,project_id=?,assignee_id=?,starts_at=?,ends_at=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND version=?",
    )
    .bind(
      input.title,
      input.description,
      input.kind,
      input.status,
      input.projectId,
      input.assigneeId,
      input.startsAt,
      input.endsAt,
      Date.now(),
      organizationId,
      id,
      version,
    )
    .run();
  return result.meta.changes === 1
    ? { ...input, id, version: version + 1 }
    : null;
}
export async function deleteItem(
  organizationId: string,
  id: string,
  version: number,
) {
  const result = await db()
    .prepare(
      "DELETE FROM planning_items WHERE organization_id=? AND id=? AND version=?",
    )
    .bind(organizationId, id, version)
    .run();
  return result.meta.changes === 1;
}
