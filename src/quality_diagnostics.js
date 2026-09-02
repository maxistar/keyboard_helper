const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|typed.?text|raw.?text|raw.?key|config(?:uration)?(?:value)?)/i;

function sanitizeString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+\\[^\s]*/g, "[PRIVATE_PATH]")
    .replace(/\/(?:home|Users)\/[^/\s]+\/[^\s]*/g, "[PRIVATE_PATH]");
}

export function redactDiagnostic(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactDiagnostic(entry),
    ]));
  }
  return typeof value === "string" ? sanitizeString(value) : value;
}
