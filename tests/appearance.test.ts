import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { avatarSources, CHARACTER_IDS, DEFAULT_APPEARANCE, parseAppearance, PORTRAIT_IDS } from "../lib/appearance.ts";

test("appearance rejects unsafe assets, invalid modes, and malformed stored records", () => {
  for (const value of [null, {}, { ...DEFAULT_APPEARANCE, motion: "fast" }, { ...DEFAULT_APPEARANCE, agents: [] },
    { ...DEFAULT_APPEARANCE, profile: { kind: "portrait", id: "../../private", background: "paper" } },
    { ...DEFAULT_APPEARANCE, profile: { kind: "character", id: "general", background: "url(https://evil.test)" } },
    { ...DEFAULT_APPEARANCE, agents: JSON.parse('{"__proto__":{"kind":"character","id":"general","background":"paper"}}') },
  ]) assert.equal(parseAppearance(value), null);
});

test("the same avatar can be used for an agent and profile; unknown data is not stored", () => {
  const avatar = { kind: "portrait", id: PORTRAIT_IDS[13], background: "mint", url: "https://untrusted.test/track" };
  const parsed = parseAppearance({ ...DEFAULT_APPEARANCE, profile: avatar, agents: { general: avatar, custom_123: avatar }, userId: "someone-else" });
  assert.ok(parsed);
  assert.deepEqual(parsed.profile, parsed.agents.general);
  assert.equal("url" in parsed.profile!, false);
  assert.equal("userId" in parsed, false);
});

test("every selectable avatar ships an animated WebP and a PNG motion fallback", () => {
  for (const [kind, ids] of [["portrait", PORTRAIT_IDS], ["character", CHARACTER_IDS]] as const) {
    for (const id of ids) {
      const sources = avatarSources({ kind, id, background: "paper" });
      const animated = readFileSync(new URL(`../public${sources.animated}`, import.meta.url));
      const still = readFileSync(new URL(`../public${sources.still}`, import.meta.url));
      assert.equal(animated.toString("ascii", 8, 12), "WEBP", id);
      assert.ok(animated.includes(Buffer.from("ANIM")), `${id} must remain animated`);
      assert.equal(still.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", id);
    }
  }
});

test('chat backgrounds are allowlisted and old appearance records keep their default', () => {
  assert.equal(parseAppearance(DEFAULT_APPEARANCE)?.chatWindowBackground ?? 'white', 'white');
  for (const mode of ['white', 'glass'] as const) assert.equal(parseAppearance({ ...DEFAULT_APPEARANCE, chatWindowBackground: mode })?.chatWindowBackground, mode);
  assert.equal(parseAppearance({ ...DEFAULT_APPEARANCE, chatWindowBackground: 'transparent-script' }), null);
});
