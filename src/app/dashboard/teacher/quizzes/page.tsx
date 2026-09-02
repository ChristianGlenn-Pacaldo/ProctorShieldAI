import QuizzesContent from "./content";
import { getSession } from "@/lib/auth";
import { getTeacherEntitlements } from "@/lib/teacher-entitlements";
import { FREE_MANUAL_QUIZ_LIMIT } from "@/lib/subscription-rules";

export default async function Page() {
  const session = await getSession();
  const entitlements = session
    ? await getTeacherEntitlements(session.userId)
    : {
        isSubscribed: false,
        manualQuizCount: 0,
        manualQuizLimit: FREE_MANUAL_QUIZ_LIMIT,
      };

  return (
    <QuizzesContent
      isSubscribed={entitlements.isSubscribed}
      initialManualQuizCount={entitlements.manualQuizCount}
      initialManualQuizLimit={entitlements.manualQuizLimit ?? FREE_MANUAL_QUIZ_LIMIT}
    />
  );
}
