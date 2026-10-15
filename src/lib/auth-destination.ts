function normalizedJoinCode(value: unknown): string | null {
  const code = typeof value === "string" && value.length <= 64
    ? value.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) && code.length >= 3 && code.length <= 64 ? code : null;
}

// Only fixed internal paths may carry a normalized quiz intent.
export function getJoinLoginDestination(joinCode: unknown): string {
  const code = normalizedJoinCode(joinCode);
  return code ? "/login?joinCode=" + encodeURIComponent(code) : "/login";
}

// Only database roles returned by successful authentication may select a route.
export function getAuthDestination(role: unknown, joinCode?: unknown): string | null {
  switch (role) {
    case "admin": return "/dashboard/admin";
    case "teacher": return "/dashboard/teacher";
    case "student": {
      const code = normalizedJoinCode(joinCode);
      return code ? "/join?code=" + encodeURIComponent(code) : "/dashboard/student";
    }
    default: return null;
  }
}
