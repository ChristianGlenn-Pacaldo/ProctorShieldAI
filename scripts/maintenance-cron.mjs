const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

try {
  const environmentId = required("RAILWAY_ENVIRONMENT_ID");
  if (environmentId !== required("OPS_APPROVED_ENVIRONMENT_ID")) throw new Error("Maintenance environment mismatch");
  const url = new URL(required("OPS_APP_ORIGIN"));
  if (url.protocol !== "https:" || url.hostname !== required("OPS_APPROVED_APP_HOST")
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Maintenance target origin mismatch");
  }
  const secret = required("CRON_SECRET");
  if (secret.length < 32) throw new Error("CRON_SECRET is too short");
  const response = await fetch(new URL("/api/internal/maintenance", url), {
    method: "POST", headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("Maintenance endpoint returned a failure");
  const body = await response.json();
  if (body?.success !== true) throw new Error("Maintenance did not report success");
  console.log(JSON.stringify({ event: "maintenance_complete", result: body.result }));
  const status = await fetch(new URL("/api/internal/maintenance", url), {
    headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!status.ok) throw new Error("Maintenance status requires attention");
} catch {
  console.error("Scheduled maintenance failed or requires attention");
  process.exitCode = 1;
}
