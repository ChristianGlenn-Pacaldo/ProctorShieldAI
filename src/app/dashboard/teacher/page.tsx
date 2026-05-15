import DashboardShell from "@/components/dashboard-shell";
import TeacherDashboardContent from "./content";

export default function TeacherDashboardPage() {
  return (
    <DashboardShell
      role="teacher"
      userName="Sir Ramos"
      userAvatar="SR"
      avatarColor="from-violet-600 to-indigo-600"
    >
      <TeacherDashboardContent />
    </DashboardShell>
  );
}
