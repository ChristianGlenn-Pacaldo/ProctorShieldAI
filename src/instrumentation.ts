/** Next calls register for server startup, including non-Node/tooling contexts.
 * Keep database imports and all background work behind these runtime guards. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production"
    || (process.env.NEXT_PHASE && process.env.NEXT_PHASE !== "phase-production-server")
    || process.env.NODE_TEST_CONTEXT || process.env.JEST_WORKER_ID || process.env.VITEST
    || process.env.FRONTEND_ONLY === "true") return;
  const { startArenaRecovery } = await import("./lib/arena-recovery");
  startArenaRecovery();
}
