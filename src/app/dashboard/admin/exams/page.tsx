import DashboardShell from "@/components/dashboard-shell";
import ExamsContent from "./content";
export default function Page() {
  return (
    <DashboardShell role="admin" userName="System Admin" userAvatar="AD" avatarColor="from-red-500 to-rose-500">
      <ExamsContent />
    </DashboardShell>
  );
}
