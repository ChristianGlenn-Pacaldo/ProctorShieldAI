"use client";

import { useState, useEffect } from "react";
import PusherClient from "pusher-js";

interface Feed {
  id: string;
  name: string;
  status: string;
  statusColor: string;
  border: string;
  lastUpdated: Date;
}

export default function LiveMonitorContent({ teacherId }: { teacherId: string }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);

  useEffect(() => {
    // If no teacherId, exit
    if (!teacherId || teacherId === "unknown") return;

    // Connect to Pusher using the client-side keys
    const pusher = new PusherClient(
      process.env.NEXT_PUBLIC_PUSHER_KEY || "db16de3d58ba71380774",
      {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap1",
      }
    );

    // Subscribe to this specific teacher's channel
    const channel = pusher.subscribe(`teacher-${teacherId}`);

    // Listen for new violations
    channel.bind("new-violation", (data: any) => {
      console.log("Real-time violation received:", data);
      
      setFeeds((prevFeeds) => {
        // Look if the student is already in the feeds
        const existingIndex = prevFeeds.findIndex(f => f.name === data.studentName);
        
        let statusText = "⚠ Alert";
        if (data.violationType === "multiple_faces") statusText = "⚠ Multiple Faces";
        if (data.violationType === "no_face") statusText = "⚠ No Face Found";
        if (data.violationType === "looking_away") statusText = "⚠ Looking Away";
        if (data.violationType === "tab_switch") statusText = "⚠ Tab Switch";

        const newFeed = {
          id: data.studentName + Date.now(),
          name: data.studentName,
          status: statusText,
          statusColor: "text-red-500",
          border: "border-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.3)] animate-pulse",
          lastUpdated: new Date()
        };

        if (existingIndex >= 0) {
          const updated = [...prevFeeds];
          updated[existingIndex] = newFeed;
          return updated;
        } else {
          return [newFeed, ...prevFeeds];
        }
      });
    });

    return () => {
      pusher.unsubscribe(`teacher-${teacherId}`);
      pusher.disconnect();
    };
  }, [teacherId]);
  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🔴 Live Monitoring — Full View</h3>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-red-500">LIVE</span>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {feeds.length === 0 ? (
              <div className="col-span-full h-32 flex flex-col items-center justify-center border border-dashed border-[var(--border)] rounded-xl text-[var(--muted)]">
                <span className="text-xl mb-2">📹</span>
                <p className="text-xs font-semibold">Waiting for active test sessions...</p>
              </div>
            ) : (
              feeds.map((f) => (
              <div key={f.name} className={`rounded-xl overflow-hidden border ${f.border} transition-transform hover:scale-[1.02] cursor-pointer`}>
                <div className="bg-slate-800 h-32 flex items-center justify-center text-white text-sm">
                  Cam Feed
                </div>
                <div className="px-3 py-2 flex items-center justify-between text-xs font-semibold text-[var(--ink)]">
                  <span>{f.name}</span>
                  <span className={f.statusColor}>{f.status}</span>
                </div>
              </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
