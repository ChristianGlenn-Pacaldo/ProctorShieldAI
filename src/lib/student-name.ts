const placeholderNames = new Set([
  "google user",
  "proctor",
  "student",
  "student fighter",
  "student user",
]);

export function normalizeStudentName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .toUpperCase();
}

export function requiresStudentNameSetup(value: string | null | undefined): boolean {
  const trimmed = (value || "").trim();
  if (!trimmed || placeholderNames.has(trimmed.toLowerCase())) return true;

  const parts = trimmed.split(",").map((part) => part.trim());
  return parts.length < 2 || parts.some((part) => !part);
}
