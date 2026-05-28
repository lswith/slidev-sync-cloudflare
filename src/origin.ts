// Origin allowlist helpers.
//
// The Origin header is the only browser-side gate against drive-by use of a
// public *.workers.dev deployment. A non-browser client (curl, wscat) can fake
// any Origin, so this is NOT a real auth mechanism — it stops browser-based
// abuse only. Pair with hash entropy + (optionally) Cloudflare Access for real
// protection.

export function parseAllowlist(raw: string | undefined): string[] | "*" {
  if (!raw || raw.trim() === "*") return "*";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isOriginAllowed(origin: string | null, allowlist: string[] | "*"): boolean {
  if (allowlist === "*") return true;
  if (!origin) return false;
  return allowlist.includes(origin);
}

/** Resolves the value to put in Access-Control-Allow-Origin (null = forbid). */
export function corsOrigin(origin: string | null, allowlist: string[] | "*"): string | null {
  if (allowlist === "*") return "*";
  if (origin && allowlist.includes(origin)) return origin;
  return null;
}
