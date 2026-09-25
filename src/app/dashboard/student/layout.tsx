import DashboardShell from "@/components/dashboard-shell";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import NameEnforcer from "@/components/name-enforcer";
import RetakeRedirect from "./retake-redirect";

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
      userInitials={initials || "SD"}
      identityColor="from-indigo-600 to-violet-600"
    >
      <NameEnforcer initialName={name} />
      <RetakeRedirect userId={session.userId} />
      {children}
    </DashboardShell>
  );
}
