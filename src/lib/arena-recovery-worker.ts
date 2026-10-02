/** One non-overlapping run followed by one unref'ed timeout. No import-time
 * work, interval, or timer capable of keeping build/test processes alive. */
export function createArenaRecoveryWorker(
  sweep: (signal: AbortSignal) => Promise<unknown>,
  options: { intervalMs?: number; onError?: () => void } = {},
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const controller = new AbortController();
  const run = () => {
    if (stopped) return;
    running = (async () => {
      try { await sweep(controller.signal); } catch { options.onError?.(); }
    })().finally(() => {
      running = undefined;
      if (!stopped) {
        timer = setTimeout(run, options.intervalMs ?? 30_000);
        timer.unref();
      }
    });
  };
  // Startup catch-up uses the same sweep as periodic recovery.
  run();
  return {
    async stop() {
      stopped = true;
      // Sweep admission and post-commit HTTP observe this signal. Active
      // PostgreSQL transactions do not: drain their durable commit/rollback.
      controller.abort();
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
