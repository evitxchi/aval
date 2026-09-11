import assert from "node:assert/strict";
import test from "node:test";
import { isDue, localParts, parseSchedule } from "../lib/channels/schedule.ts";
import { scrub, phoneFingerprint, scrubValue, scrubError } from "../lib/channels/scrub.ts";

// A subscription that fires at the wrong hour is a notification people mute,
// and a muted channel has stopped working. A subscription that fires sixty
// times an hour is worse.

test("schedules parse, and anything unrecognised never fires", () => {
  assert.deepEqual(parseSchedule("daily@8"), { kind: "daily", hour: 8 });
  assert.deepEqual(parseSchedule("weekly@1:8"), { kind: "weekly", weekday: 1, hour: 8 });
  assert.deepEqual(parseSchedule("every@6"), { kind: "every", hours: 6 });
  for (const bad of ["", "daily@25", "weekly@9:8", "every@0", "* * * * *", "daily@", "hourly"]) {
    assert.equal(parseSchedule(bad), null, bad);
  }
});

test("a Monday 08:00 subscription fires on Monday at 08:00 local", () => {
  // 2026-09-14 is a Monday. Mexico abolished DST in 2022, so America/Mexico_City
  // is permanently UTC-6 and 14:00 UTC is 08:00 local year-round.
  const monday = new Date("2026-09-14T14:00:00Z");
  assert.equal(isDue("weekly@1:8", "America/Mexico_City", null, monday), true);
});

test("it does not fire on the wrong day or the wrong hour", () => {
  const tuesday = new Date("2026-09-15T14:00:00Z");
  assert.equal(isDue("weekly@1:8", "America/Mexico_City", null, tuesday), false);
  const mondayNoon = new Date("2026-09-14T17:00:00Z"); // 12:00 local
  assert.equal(isDue("weekly@1:8", "America/Mexico_City", null, mondayNoon), false);
});

test("it fires once per local day, not once per minute", () => {
  // The cron runs every minute; the same 08:00 hour is seen sixty times.
  const first = new Date("2026-09-14T14:00:00Z");
  const laterSameHour = new Date("2026-09-14T14:31:00Z");
  assert.equal(isDue("weekly@1:8", "America/Mexico_City", null, first), true);
  assert.equal(isDue("weekly@1:8", "America/Mexico_City", first, laterSameHour), false);
});

test("a daily schedule fires again the next local day", () => {
  const day1 = new Date("2026-09-14T14:00:00Z");
  const day2 = new Date("2026-09-15T14:00:00Z");
  assert.equal(isDue("daily@8", "America/Mexico_City", day1, day2), true);
});

test("an unknown timezone falls back to UTC rather than taking the batch down", () => {
  const at8utc = new Date("2026-09-14T08:00:00Z");
  assert.doesNotThrow(() => isDue("daily@8", "Not/AZone", null, at8utc));
  assert.equal(isDue("daily@8", "Not/AZone", null, at8utc), true);
});

test("midnight is hour 0, not hour 24", () => {
  const midnightUtc = new Date("2026-09-14T00:00:00Z");
  assert.equal(localParts(midnightUtc, "UTC").hour, 0);
  assert.equal(isDue("daily@0", "UTC", null, midnightUtc), true);
});

test("an interval schedule respects its interval", () => {
  const start = new Date("2026-09-14T00:00:00Z");
  assert.equal(isDue("every@6", "UTC", start, new Date("2026-09-14T05:00:00Z")), false);
  assert.equal(isDue("every@6", "UTC", start, new Date("2026-09-14T06:00:00Z")), true);
});

// Scrubbing. This channel handles a real person's phone number and the text
// they wrote, at once. Neither may reach an error report.

test("Mexican national identifiers are redacted", () => {
  // CURP and RFC are personal data under the LFPDPPP.
  assert.ok(!scrub("my curp is GOMC800101HDFNRL09").includes("GOMC800101HDFNRL09"));
  assert.ok(scrub("CURP GOMC800101HDFNRL09").includes("[curp]"));
  assert.ok(scrub("RFC GODE561231GR8").includes("[rfc]"));
});

test("phones, emails and tokens are redacted", () => {
  assert.ok(!scrub("call +52 55 1234 5678").includes("1234"));
  assert.ok(scrub("write to ana@example.com").includes("[email]"));
  assert.ok(scrub("Authorization: Bearer abc123.def456").includes("[redacted]"));
  assert.ok(scrub(`token EAA${"x".repeat(30)}`).includes("[token]"));
});

test("a token in a URL query string is redacted, not just the header form", () => {
  const url = "https://graph.facebook.com/v21.0/me?access_token=SECRETVALUE&fields=id";
  const scrubbed = scrub(url);
  assert.ok(!scrubbed.includes("SECRETVALUE"));
  assert.ok(scrubbed.includes("fields=id"), "the non-sensitive part should survive for debugging");
});

test("a phone fingerprint correlates without dialling", () => {
  const fingerprint = phoneFingerprint("+525512345678");
  assert.ok(!fingerprint.includes("5512345"), "the identifying middle must be gone");
  assert.equal(fingerprint, phoneFingerprint("+525512345678"), "the same number gives the same fingerprint");
  assert.notEqual(fingerprint, phoneFingerprint("+525599999999"));
});

test("sensitive keys are dropped by name, whatever their value looks like", () => {
  const scrubbed = scrubValue({ body: "innocuous", accessToken: "x", role: "owner", count: 3 }) as Record<string, unknown>;
  // `body` holds whatever the sender wrote — sensitive regardless of content.
  assert.equal(scrubbed.body, "[redacted]");
  assert.equal(scrubbed.accessToken, "[redacted]");
  assert.equal(scrubbed.role, "owner", "operational fields must survive or the trace is useless");
  assert.equal(scrubbed.count, 3);
});

test("an error message is scrubbed and its stack dropped", () => {
  const message = scrubError(new Error("failed to send to +525512345678"));
  assert.ok(!message.includes("5512345678"));
  assert.ok(!message.includes("at "), "no stack frames");
});
