import http from "node:http";
import type { Socket } from "node:net";

export type ReceivedArenaEvent = { path: string; name: string; channels: string[]; data: Record<string, unknown>; body: string };
export type ReceiverBehavior = "success" | "stall" | "stall-body" | "reject" | "redirect";

export async function arenaHttpReceiver() {
  const sockets = new Set<Socket>();
  const requests: ReceivedArenaEvent[] = [];
  let behavior: (event: ReceivedArenaEvent) => ReceiverBehavior = () => "success";
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const wire = JSON.parse(body);
      const event = { path: request.url!, body, name: wire.name, channels: wire.channels, data: JSON.parse(wire.data) };
      requests.push(event);
      const selected = behavior(event);
      if (selected === "stall") return;
      if (selected === "stall-body") { response.writeHead(200); response.write("private-provider-body"); return; }
      if (selected === "redirect") { response.writeHead(302, { location: "http://127.0.0.1:1/never-follow" }); response.end(); return; }
      response.writeHead(selected === "reject" ? 403 : 200, { "content-type": "application/json" });
      response.end(selected === "reject" ? "private-provider-rejection" : "{}");
    });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  return {
    endpoint, requests, sockets,
    setBehavior(next: (event: ReceivedArenaEvent) => ReceiverBehavior) { behavior = next; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function waitForArenaCondition(check: () => boolean | Promise<boolean>) {
  for (let n = 0; n < 500; n++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Isolated Arena acceptance condition timed out");
}
