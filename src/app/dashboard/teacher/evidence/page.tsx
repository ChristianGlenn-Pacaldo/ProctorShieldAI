import DashboardShell from "@/components/dashboard-shell";
import EvidenceContent from "./content";
export default function Page() {
  return (
    <DashboardShell role="teacher" userName="Sir Ramos" userAvatar="SR" avatarColor="from-violet-600 to-indigo-600">
      <EvidenceContent />
    </DashboardShell>
  );
}
