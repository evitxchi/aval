export type WorkspaceMode = "live" | "demo";

// Resolved on the server, before any workspace providers or effects mount.
export function resolveWorkspaceMode(
  isGuest: boolean,
  requested: unknown,
): WorkspaceMode {
  return isGuest || requested === "sample" || requested === "demo"
    ? "demo"
    : "live";
}

export function workspaceModeUrl(
  href: string,
  mode: WorkspaceMode,
  isGuest = false,
): string {
  const url = new URL(href);
  url.searchParams.set("data", mode === "demo" ? "sample" : "live");
  url.searchParams.delete("connected");
  url.searchParams.delete("signin");
  if (mode === "live" && isGuest) url.searchParams.set("signin", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
