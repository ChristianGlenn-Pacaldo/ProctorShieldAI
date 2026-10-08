import DashboardShell from "@/components/dashboard-shell";
import { getUserSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import "./teacher-theme.css";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession();

  if (!session || session.role !== "teacher") {
    redirect("/login");
  }

  const name = session.fullName;
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DashboardShell
      key={`${session.userId}:${session.sessionVersion}`}
      role="teacher"
      userName={name}
      userInitials={initials || "TR"}
      identityColor="from-violet-600 to-indigo-600"
    >
      <div className="teacher-content">{children}</div>
    </DashboardShell>
  );
}
