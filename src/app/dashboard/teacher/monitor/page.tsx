import DashboardShell from "@/components/dashboard-shell";
import LiveMonitorContent from "./content";
import { getSession } from "@/lib/auth";

export default async function Page() {
  const session = await getSession();
  const userName = session?.fullName || "Teacher";
  const userId = session?.userId || "unknown";

  return (
    <DashboardShell role="teacher" userName={userName} userAvatar={userName.substring(0, 2).toUpperCase()} avatarColor="from-violet-600 to-indigo-600">
      <LiveMonitorContent teacherId={userId} />
    </DashboardShell>
  );
}
