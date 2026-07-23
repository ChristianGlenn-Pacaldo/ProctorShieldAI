import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import BillingContent from "./content";
import prisma from "@/lib/prisma";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const resolvedParams = await searchParams;
  const session = await getSession();

  if (!session || session.role !== "teacher") {
    redirect("/login");
  }

  // Fetch user's active subscription
  const activeSub = await prisma.userSubscription.findFirst({
    where: {
      userId: session.userId,
      subscriptionStatus: "active",
      endDate: { gt: new Date() },
    },
    include: { plan: true },
  });

  return (
    <BillingContent
      isSubscribed={!!activeSub}
      planName={activeSub?.plan.planName}
      endDate={activeSub?.endDate?.toISOString()}
      success={resolvedParams.success === "true"}
      canceled={resolvedParams.canceled === "true"}
    />
  );
}
