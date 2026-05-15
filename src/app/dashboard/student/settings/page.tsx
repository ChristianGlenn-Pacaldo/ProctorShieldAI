import DashboardShell from "@/components/dashboard-shell";
import SettingsContent from "./content";
export default function Page() {
  return (
    <DashboardShell role="student" userName="Juan Dela Cruz" userAvatar="JD" avatarColor="from-indigo-600 to-violet-600">
      <SettingsContent />
    </DashboardShell>
  );
}
