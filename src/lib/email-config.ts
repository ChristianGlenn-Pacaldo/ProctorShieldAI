type EmailEnvironment = Partial<Record<
  "NODE_ENV" | "EMAIL_PROVIDER" | "RESEND_API_KEY" | "EMAIL_FROM" | "SMTP_EMAIL" | "SMTP_PASSWORD"
  | "GMAIL_SENDER_EMAIL" | "GMAIL_OAUTH_CLIENT_ID" | "GMAIL_OAUTH_CLIENT_SECRET" | "GMAIL_OAUTH_REFRESH_TOKEN",
  string
>>;

export type EmailConfiguration =
  | { provider: "resend"; apiKey: string; from: string }
  | { provider: "gmail-api"; sender: string; clientId: string; clientSecret: string; refreshToken: string }
  | { provider: "smtp"; email: string; password: string };

function isEmailAddress(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function isSender(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  const namedSender = value.match(/^[^<>]+<([^<>]+)>$/);
  return isEmailAddress(namedSender?.[1]?.trim() ?? value);
}

export function resolveEmailConfiguration(
  environment: EmailEnvironment = process.env,
  requireExplicitProvider = environment.NODE_ENV === "production",
): EmailConfiguration {
  const selected = environment.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!selected && requireExplicitProvider) {
    throw new Error("EMAIL_PROVIDER must be explicitly set to smtp, gmail-api or resend for production preflight");
  }

  // An unset provider preserves the local development SMTP default only.
  const provider = selected || "smtp";
  if (provider === "gmail-api") {
    const sender = environment.GMAIL_SENDER_EMAIL?.trim() ?? "";
    if (!isEmailAddress(sender) || /[;,]/.test(sender)) {
      throw new Error("EMAIL_PROVIDER=gmail-api requires a valid GMAIL_SENDER_EMAIL address");
    }
    const clientId = environment.GMAIL_OAUTH_CLIENT_ID?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new Error("EMAIL_PROVIDER=gmail-api requires a valid GMAIL_OAUTH_CLIENT_ID");
    }
    const clientSecret = environment.GMAIL_OAUTH_CLIENT_SECRET?.trim() ?? "";
    if (!clientSecret || /\s/.test(clientSecret)) {
      throw new Error("EMAIL_PROVIDER=gmail-api requires GMAIL_OAUTH_CLIENT_SECRET");
    }
    const refreshToken = environment.GMAIL_OAUTH_REFRESH_TOKEN?.trim() ?? "";
    if (!refreshToken || /\s/.test(refreshToken)) {
      throw new Error("EMAIL_PROVIDER=gmail-api requires GMAIL_OAUTH_REFRESH_TOKEN");
    }
    return { provider, sender, clientId, clientSecret, refreshToken };
  }
  if (provider === "resend") {
    const apiKey = environment.RESEND_API_KEY?.trim() ?? "";
    const from = environment.EMAIL_FROM?.trim() ?? "";
    if (!/^re_[A-Za-z0-9_-]+$/.test(apiKey)) {
      throw new Error("EMAIL_PROVIDER=resend requires a valid RESEND_API_KEY");
    }
    if (!isSender(from)) {
      throw new Error("EMAIL_PROVIDER=resend requires a valid EMAIL_FROM sender address");
    }
    return { provider, apiKey, from };
  }

  if (provider === "smtp") {
    const email = environment.SMTP_EMAIL?.trim() ?? "";
    const password = environment.SMTP_PASSWORD ?? "";
    if (!isEmailAddress(email)) {
      throw new Error("EMAIL_PROVIDER=smtp requires a valid SMTP_EMAIL address");
    }
    if (!password.trim()) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_PASSWORD");
    }
    return { provider, email, password };
  }

  throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}. Use smtp, gmail-api or resend`);
}
