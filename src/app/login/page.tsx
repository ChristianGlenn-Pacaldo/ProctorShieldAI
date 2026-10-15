import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAuthDestination } from "@/lib/auth-destination";
import LoginContent from "./content";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const joinCode = typeof params.joinCode === "string" ? params.joinCode : undefined;
  const joiningQuiz = getAuthDestination("student", joinCode) !== "/dashboard/student";
  // Preserve explicit Student reauthentication if a guarded link reaches here.
  const reasons = Array.isArray(params.reason) ? params.reason : [params.reason];
  if (reasons.includes("session-changed") || "_retakeStudent" in params) return <LoginContent joinCode={joinCode} />;

  let session;
  try {
    // The existing mixed-class reader denies both current cookies. This GET
    // validates the database identity without touching account activity.
    session = await getSession(undefined, { touchActivity: false });
  } catch {
    return <LoginContent sessionUnavailable joinCode={joinCode} />;
  }
  // A Teacher/Admin session cannot adopt a Student join intent.
  if (joiningQuiz && session?.role !== "student") return <LoginContent joinCode={joinCode} />;
  const destination = getAuthDestination(session?.role, joinCode);
  // Next's redirect throws; keep it outside the validation error handler.
  if (destination) redirect(destination);
  return <LoginContent joinCode={joinCode} />;
}
