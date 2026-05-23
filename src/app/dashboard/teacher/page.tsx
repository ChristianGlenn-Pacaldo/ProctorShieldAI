import TeacherDashboardContent from "./content";
import { getSession } from "@/lib/auth";

export default async function TeacherDashboardPage() {
  const session = await getSession();
  const userId = session?.userId || "unknown";

  return <TeacherDashboardContent teacherId={userId} />;
}
