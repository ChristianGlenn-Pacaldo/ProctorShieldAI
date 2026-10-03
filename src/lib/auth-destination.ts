// Only database roles returned by successful authentication may select a route.
export function getAuthDestination(role: unknown): string | null {
  switch (role) {
    case "admin": return "/dashboard/admin";
    case "teacher": return "/dashboard/teacher";
    case "student": return "/dashboard/student";
    default: return null;
  }
}
