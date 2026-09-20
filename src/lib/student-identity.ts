export function getStudentInitials(
  fullName: string | null | undefined,
  fallback = "",
): string {
  const nameParts = (fullName || "")
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (nameParts.length === 0) {
    return fallback.trim().slice(0, 2).toUpperCase();
  }

  return nameParts
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
}
