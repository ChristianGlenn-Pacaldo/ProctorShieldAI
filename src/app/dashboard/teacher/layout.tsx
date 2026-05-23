import DashboardShell from "@/components/dashboard-shell";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

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
      role="teacher"
      userName={name}
      userAvatar={initials || "TR"}
      avatarColor="from-violet-600 to-indigo-600"
    >
      {children}
    </DashboardShell>
  );
}
