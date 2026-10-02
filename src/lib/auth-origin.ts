// Browser authentication mutations require an explicit same-origin request.
// Webhooks/internal bearer routes do not use this guard. Never trust forwarded
// host headers as a CSRF allowlist. SameSite cookies are additional protection.
export function isTrustedAuthOrigin(request: Pick<Request, "url" | "headers">): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const allowed = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
    const supplied = new URL(origin);
    return supplied.origin === allowed && origin === supplied.origin;
  } catch { return false; }
}
