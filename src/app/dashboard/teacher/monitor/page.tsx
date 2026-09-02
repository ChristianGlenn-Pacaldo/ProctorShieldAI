import LiveMonitorContent from "./content";
import { getSession } from "@/lib/auth";
import { hasActiveProSubscription } from "@/lib/teacher-entitlements";

export default async function Page() {
  const session = await getSession();
  const userId = session?.userId || "unknown";
  const isSubscribed = session ? await hasActiveProSubscription(session.userId) : false;

  return <LiveMonitorContent teacherId={userId} initialIsSubscribed={isSubscribed} />;
}
