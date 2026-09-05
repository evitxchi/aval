/** Provider messages can quote prompts or tool inputs. Only fixed explanations
 * and a validated request ID may reach task records, users, or CI logs. */
export function anthropicFailure(status: number, body: unknown, requestId?: string | null) {
  const outer = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const error = outer.error && typeof outer.error === "object" ? outer.error as Record<string, unknown> : outer;
  const detail = typeof error.message === "string" ? error.message : "";
  let code = "provider_error";
  let explanation = "Anthropic could not complete the request.";
  let retryable = [408, 409, 429].includes(status) || status >= 500;

  if (status === 400 && /credit balance.{0,30}(?:too low|insufficient)|insufficient.{0,20}credits/i.test(detail)) {
    code = "insufficient_credits";
    explanation = "The Anthropic API account has insufficient credits. Its administrator must add API credits in Claude Console.";
    retryable = false;
  } else if ([400, 429].includes(status) && /(?:spend|spending).{0,30}(?:limit|cap)|(?:limit|cap).{0,30}(?:spend|spending)|monthly.{0,20}usage.{0,20}(?:limit|cap)/i.test(detail)) {
    code = "spend_limit";
    explanation = "The Anthropic API account or workspace has reached a spending limit. Its administrator must review the limit in Claude Console.";
    retryable = false;
  } else if (status === 402) {
    code = "billing_error";
    explanation = "Anthropic rejected the request because of an API billing problem. Its administrator must review billing in Claude Console.";
  } else if (status === 401) {
    code = "authentication_error";
    explanation = "Anthropic rejected the configured API key. The deployment administrator must update the credential.";
  } else if (status === 403) {
    code = "permission_error";
    explanation = "The Anthropic API key does not have permission for this request. Check its workspace and model access.";
  } else if (status === 404 || (status === 400 && /model.{0,60}(?:not found|not available|not supported|does not exist|do not have access|deprecated|retired)/i.test(detail))) {
    code = "model_unavailable";
    explanation = "The configured Anthropic model is unavailable. Check the deployment's model ID and API account access.";
  } else if (status === 400 || status === 422) {
    code = "invalid_request";
    explanation = "Anthropic rejected the model request's format or parameters. Use the request ID to investigate the provider validation error.";
  } else if (status === 429) {
    code = "rate_limit";
    explanation = "Anthropic temporarily rate-limited the request. Aval can retry after the limit resets.";
  }
  const id = typeof requestId === "string" && /^req_[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? requestId : undefined;
  return {
    code, status, retryable, requestId: id,
    message: `${explanation} (HTTP ${status}; ${code}${id ? `; request ${id}` : ""})`,
  };
}
