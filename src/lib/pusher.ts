import Pusher from "pusher";

// We use process.env to hold Pusher config
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || "demo_app_id",
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || "demo_key",
  secret: process.env.PUSHER_SECRET || "demo_secret",
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
  useTLS: true,
});
