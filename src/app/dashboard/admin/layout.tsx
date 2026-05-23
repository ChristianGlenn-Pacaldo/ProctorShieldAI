import DashboardShell from "@/components/dashboard-shell";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session || session.role !== "admin") {
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
      role="admin"
      userName={name}
      userAvatar={initials || "AD"}
      avatarColor="from-red-500 to-rose-500"
    >
      {children}
    </DashboardShell>
  );
}
