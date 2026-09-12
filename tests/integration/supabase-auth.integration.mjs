import assert from "node:assert/strict";
import test from "node:test";

import { signInWithSupabasePassword, SupabaseAuthError } from "../../lib/auth/supabase.ts";

test("Supabase Auth uses the redirect mode supported by Cloudflare Workers", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://project.supabase.co/auth/v1/token?grant_type=password");
    assert.equal(init.redirect, "manual");
    return Response.json({ message: "Invalid login credentials" }, { status: 400 });
  });

  await assert.rejects(
    signInWithSupabasePassword(
      new Request("https://app.aval.llc/api/auth/login"),
      { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "test-key" },
      "person@example.com",
      "invalid",
    ),
    (error) => error instanceof SupabaseAuthError && error.status === 400,
  );
});
