/**
 * An approval authorizes one exact model proposal, not every call sharing the
 * same tool name in the assistant message.
 */
export function approvalMatchesToolUse(
  evidenceJson: string,
  toolUse: { id: string; name: string },
  approvedToolName: string,
): boolean {
  if (toolUse.name !== approvedToolName) return false;
  try {
    const evidence = JSON.parse(evidenceJson) as { toolUseId?: unknown };
    return typeof evidence.toolUseId === "string" && evidence.toolUseId === toolUse.id;
  } catch {
    return false;
  }
}
