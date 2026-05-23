import DashboardShell from "@/components/dashboard-shell";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

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
      role="student"
      userName={name}
      userAvatar={initials || "SD"}
      avatarColor="from-indigo-600 to-violet-600"
    >
      {children}
    </DashboardShell>
  );
}
