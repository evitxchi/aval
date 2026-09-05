import { env } from "cloudflare:workers";
import { DEFAULT_APPEARANCE, parseAppearance, type AppearancePreferences, type AvatarSelection } from "./appearance";

function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Appearance storage is unavailable");
  return db;
}

export async function readAppearance(userId: string): Promise<AppearancePreferences> {
  const row = await database().prepare("SELECT preferences FROM user_appearance WHERE user_id = ?").bind(userId).first<{ preferences: string }>();
  if (!row) return DEFAULT_APPEARANCE;
  try { return parseAppearance(JSON.parse(row.preferences)) ?? DEFAULT_APPEARANCE; }
  catch { return DEFAULT_APPEARANCE; }
}

export async function writeAppearance(userId: string, preferences: AppearancePreferences) {
  await database().prepare(`INSERT INTO user_appearance (user_id, preferences, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences, updated_at = excluded.updated_at`)
    .bind(userId, JSON.stringify(preferences), Date.now()).run();
}

/** Call only with the authenticated workspace's roster; never expose agents or motion preferences. */
export async function memberProfileAvatars(userIds: string[]): Promise<Map<string, AvatarSelection>> {
  const result = new Map<string, AvatarSelection>();
  for (let offset = 0; offset < userIds.length; offset += 50) {
    const ids = userIds.slice(offset, offset + 50);
    const rows = await database().prepare(`SELECT user_id, preferences FROM user_appearance WHERE user_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids).all<{ user_id: string; preferences: string }>();
    for (const row of rows.results) {
      try {
        const profile = parseAppearance(JSON.parse(row.preferences))?.profile;
        if (profile) result.set(row.user_id, profile);
      } catch { /* A malformed preference never prevents loading the team. */ }
    }
  }
  return result;
}
