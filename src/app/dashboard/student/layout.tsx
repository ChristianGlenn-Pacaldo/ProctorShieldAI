import "./student.css";
import "./student-glass.css";
import DashboardShell from "@/components/dashboard-shell";
import { getUserSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import NameEnforcer from "@/components/name-enforcer";
import RetakeRedirect from "./retake-redirect";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession();

  if (!session || session.role !== "student") {
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
      role="student"
      userName={name}
      userInitials={initials || "SD"}
      identityColor="from-indigo-600 to-violet-600"
    >
      <NameEnforcer initialName={name} />
      <RetakeRedirect userId={session.userId} />
      {children}
    </DashboardShell>
  );
}
