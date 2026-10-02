import PusherServer from "pusher";
import { createArenaPusherDelivery } from "./arena-pusher-transport.ts";

// Server-side Pusher instance (for API routes only)
export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
});

// Keep unrelated SDK delivery/auth behavior unchanged. Only Arena opts into
// bounded HTTP delivery and caller cancellation, with identical SDK signing.
export const arenaPusher = createArenaPusherDelivery({
  appId: process.env.PUSHER_APP_ID!, cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!, signer: pusherServer,
});
