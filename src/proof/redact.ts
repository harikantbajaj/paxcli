/**
 * Receipt redaction: receipts contain prompts, diffs, and command output that
 * can carry secrets. The redacted variant is what `run report` and `paxcli pr`
 * publish; the full variant stays local.
 */

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Provider-shaped keys
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  // PEM blocks
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]',
  ],
  // Assignment-shaped secrets: password=..., api_key: "...", TOKEN='...'
  [
    /\b([\w-]*(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token))(\s*[:=]\s*)(["']?)[^\s"']{6,}\3/gi,
    '$1$2$3[REDACTED]$3',
  ],
  // Bearer headers
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}/g, '$1[REDACTED]'],
  // Connection strings with credentials
  [/\b([a-z]{2,10}:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1$2:[REDACTED]@'],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Deep-redacts every string field of a JSON-serializable value. */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v);
    }
    return out as T;
  }
  return value;
}

/** True when redaction changed anything — useful to warn before sharing. */
export function containsSecrets(text: string): boolean {
  return redactText(text) !== text;
}
