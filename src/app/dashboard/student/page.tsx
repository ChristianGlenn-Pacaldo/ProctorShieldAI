import DashboardShell from "@/components/dashboard-shell";
import StudentDashboardContent from "./content";

export default function StudentDashboardPage() {
  return (
    <DashboardShell
      role="student"
      userName="Juan Dela Cruz"
      userAvatar="JD"
      avatarColor="from-indigo-600 to-violet-600"
    >
      <StudentDashboardContent />
    </DashboardShell>
  );
}
