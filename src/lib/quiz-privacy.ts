/** Only an explicitly verified institutional configuration may supply contacts. */
export const QUIZ_PRIVACY_SETTING_KEYS = [
  "evidence_retention_days", "institution_privacy_contacts_verified",
  "institution_name", "institution_privacy_email", "institution_privacy_url",
] as const;
export type QuizPrivacyInfo = {
  retentionDays: number;
  institution: string | null;
  contact: { email: string | null; url: string | null } | null;
};
export function quizPrivacyInfo(settings: Array<{ settingKey: string; settingValue: string | null }>, retentionDays: number): QuizPrivacyInfo {
  const values = new Map(settings.map(row => [row.settingKey, row.settingValue?.trim() ?? ""]));
  const result: QuizPrivacyInfo = { retentionDays, institution: null, contact: null };
  if (values.get("institution_privacy_contacts_verified") !== "true") return result;
  const email = values.get("institution_privacy_email") || "";
  let url: string | null = null;
  try {
    const parsed = new URL(values.get("institution_privacy_url") || "");
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.href.length <= 2048) url = parsed.href;
  } catch { /* Unconfigured or invalid contact: omit it. */ }
  const safeEmail = email.length <= 254 && /^[^\s@<>:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email) ? email : null;
  if (safeEmail || url) {
    result.institution = (values.get("institution_name") || "").slice(0, 160) || null;
    result.contact = { email: safeEmail, url };
  }
  return result;
}

