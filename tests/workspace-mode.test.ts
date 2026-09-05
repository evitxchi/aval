import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWorkspaceMode,
  workspaceModeUrl,
} from "../lib/workspace-mode.ts";

test("authenticated workspaces default to real data; samples require an explicit mode", () => {
  for (const value of [undefined, "live", "empty", "unknown", ["sample"]])
    assert.equal(resolveWorkspaceMode(false, value), "live");
  for (const value of ["sample", "demo"])
    assert.equal(resolveWorkspaceMode(false, value), "demo");
  assert.equal(resolveWorkspaceMode(true, "live"), "demo");
});
test("exiting the demo preserves the page and removes the demo and connection-success state", () => {
  const url = workspaceModeUrl(
    "https://aval.test/en?data=sample&view=settings&connected=quickbooks",
    "live",
  );
  assert.equal(url, "/en?data=live&view=settings");
  assert.equal(
    resolveWorkspaceMode(
      false,
      new URL(url, "https://aval.test").searchParams.get("data"),
    ),
    "live",
  );
  assert.match(
    workspaceModeUrl("https://aval.test/es-mx?data=sample", "live", true),
    /signin=1/,
  );
});
