export type NotificationRole = "student" | "teacher" | "admin";

const DESTINATIONS: Record<NotificationRole, Array<{ titles: string[]; href: string }>> = {
  student: [
    { titles: ["quiz completed"], href: "/dashboard/student/results" },
    { titles: ["ai proctoring report ready"], href: "/dashboard/student/reports" },
    { titles: ["retake request approved", "retake request rejected", "quiz joined"], href: "/dashboard/student/quizzes" },
  ],
  teacher: [
    { titles: ["retake request submitted", "late join request", "student joined quiz"], href: "/dashboard/teacher/monitor" },
    { titles: ["quiz submission received", "ai verdict issued"], href: "/dashboard/teacher/reports" },
  ],
  admin: [
    { titles: ["new login", "new google sign-up"], href: "/dashboard/admin/users" },
  ],
};

const ROLE_HOME: Record<NotificationRole, string> = {
  student: "/dashboard/student",
  teacher: "/dashboard/teacher",
  admin: "/dashboard/admin",
};

export function getNotificationDestination(role: string, title: string): string {
  if (!(role in DESTINATIONS)) return "/login";
  const safeRole = role as NotificationRole;
  const normalizedTitle = title.trim().toLowerCase();
  return DESTINATIONS[safeRole].find((entry) => entry.titles.includes(normalizedTitle))?.href
    ?? ROLE_HOME[safeRole];
}
