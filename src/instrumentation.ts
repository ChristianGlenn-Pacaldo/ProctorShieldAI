/** Next compiles this hook for both Edge and Node. Keep the Node dependency
 * inside an explicit runtime branch so Edge compilation can eliminate it. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV !== "production"
      || (process.env.NEXT_PHASE && process.env.NEXT_PHASE !== "phase-production-server")
      || process.env.NODE_TEST_CONTEXT || process.env.JEST_WORKER_ID || process.env.VITEST
      || process.env.FRONTEND_ONLY === "true") return;
    const { startArenaRecovery } = await import("./lib/arena-recovery");
    startArenaRecovery();
  }
}
