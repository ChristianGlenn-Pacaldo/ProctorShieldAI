import "server-only";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { EmailConfiguration } from "./email-config.ts";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
type GmailConfiguration = Extract<EmailConfiguration, { provider: "gmail-api" }>;
type MailMessage = { to: string; subject: string; html: string };

async function requestJson(url: string, init: RequestInit, label: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Fetch/provider exceptions may include credentials or message content.
    throw new Error(`${label} request failed`);
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error(`${label} returned invalid JSON`); }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return result as Record<string, unknown>;
}

export async function sendGmailApiEmail(configuration: GmailConfiguration, message: MailMessage): Promise<string> {
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(message.to)) {
    throw new Error("Gmail API requires a single valid recipient email address");
  }
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      refresh_token: configuration.refreshToken,
      grant_type: "refresh_token",
      scope: GMAIL_SEND_SCOPE,
    }).toString(),
  }, "Gmail OAuth token refresh");
  if (typeof token.access_token !== "string" || !token.access_token || /\s/.test(token.access_token)
    || typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer"
    || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error("Gmail OAuth token refresh returned invalid access credentials");
  }
  // Authorization must grant only gmail.send. A refresh cannot add privileges.
  if (typeof token.scope !== "string" || token.scope.trim() !== GMAIL_SEND_SCOPE) {
    throw new Error("Gmail OAuth token must have only the gmail.send scope");
  }
  const mime = await new MailComposer({
    from: { name: "ProctorShield AI", address: configuration.sender },
    ...message,
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile().build();
  const result = await requestJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: mime.toString("base64url") }),
  }, "Gmail email API");
  if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) {
    throw new Error("Gmail email API returned no valid message ID");
  }
  return result.id;
}
