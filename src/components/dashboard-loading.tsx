"use client";

import { LoaderSkeleton, type LoaderSkeletonProps } from "@/components/ui/loaders-skeleton";
import styles from "./dashboard-loading.module.css";

function Placeholder(props: LoaderSkeletonProps) {
  return (
    <LoaderSkeleton
      baseColor="var(--ps-surface-inset)"
      highlightColor="var(--ps-accent-soft)"
      {...props}
    />
  );
}

// One status per overview, outside its busy sections. Shapes are decorative.
export function DashboardLoadingStatus({ label }: { label: string }) {
  return <span className="sr-only" role="status" aria-atomic="true">{label}</span>;
}

export function MetricValueSkeleton() {
  return (
    <span aria-hidden="true" className={`${styles.delayed} ${styles.metric}`}>
      <Placeholder width="3ch" height={32} className={styles.metricShape} />
    </span>
  );
}

export function DashboardListSkeleton({
  variant = "list",
  count = 3,
}: {
  variant?: "quiz" | "list" | "chart" | "table";
  count?: number;
}) {
  return (
    <div aria-hidden="true" className={`${styles.delayed} ${styles[variant]}`}>
      {Array.from({ length: count }, (_, index) => (
        <div className={styles.item} key={index}>
          {variant === "chart" ? (
            <>
              <Placeholder width="28%" height={12} />
              <Placeholder width="54%" height={10} borderRadius={5} />
              <Placeholder width="8%" height={12} />
            </>
          ) : variant === "table" ? (
            <>
              <Placeholder width="32%" height={16} />
              <Placeholder width="38%" height={12} />
              <Placeholder width="20%" height={20} />
            </>
          ) : (
            <>
              <Placeholder width={variant === "quiz" ? "36%" : 32} height={variant === "quiz" ? 20 : 32} borderRadius={8} />
              <div className={styles.lines}>
                <Placeholder width="72%" height={16} />
                <Placeholder width="48%" height={12} />
              </div>
              {variant === "quiz" && <Placeholder height={36} borderRadius={8} />}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
