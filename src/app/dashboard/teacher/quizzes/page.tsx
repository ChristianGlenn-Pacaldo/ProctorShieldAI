import QuizzesContent from "./content";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export default async function Page() {
  const session = await getSession();
  let isSubscribed = false;

  if (session) {
    const activeSub = await prisma.userSubscription.findFirst({
      where: {
        userId: session.userId,
        subscriptionStatus: "active",
        endDate: { gt: new Date() },
      },
    });
    isSubscribed = !!activeSub;
  }

  return <QuizzesContent isSubscribed={isSubscribed} />;
}
