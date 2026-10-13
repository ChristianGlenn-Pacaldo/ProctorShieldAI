import "./admin.css";
import "./admin-glass.css";
import DashboardShell from "@/components/dashboard-shell";
import { getAdminSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();

  if (!session || session.role !== "admin") {
    redirect("/admin/login");
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
      userInitials={initials || "AD"}
      identityColor="from-red-500 to-rose-500"
    >
      <div className="ps-admin-page">{children}</div>
    </DashboardShell>
  );
}
