"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, AlertTriangle, CheckCircle, Monitor } from "lucide-react";

export default function QuizRoom() {
  const params = useParams();
  const examId = params.id as string;
  const router = useRouter();

  const [hasStarted, setHasStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize Webcam
  useEffect(() => {
    if (hasStarted) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setCameraActive(true);
          }
        })
        .catch((err) => {
          console.error("Camera access denied:", err);
          alert("You must allow camera access to take this exam.");
        });
    }

    return () => {
      // Cleanup camera on unmount
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, [hasStarted]);

  // Handle Tab Switching (Cheating Detection)
  useEffect(() => {
    if (!hasStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // User switched tabs!
        reportViolation("tab_switch");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [hasStarted]);

  const reportViolation = async (type: string) => {
    setViolationCount((prev) => prev + 1);
    try {
      await fetch("/api/live/violation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examId,
          violationType: type,
          confidenceScore: 100, // 100% sure if tab switch
        }),
      });
    } catch (err) {
      console.error("Failed to report violation:", err);
    }
  };

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-4">
        <div className="bg-[var(--surface)] p-8 rounded-2xl border border-[var(--border)] max-w-lg w-full text-center">
          <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Camera className="w-8 h-8 text-indigo-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Proctoring Initialization</h1>
          <p className="text-[var(--muted)] mb-8">
            This exam is monitored by ProctorShield AI. Your camera, microphone, and screen activity will be recorded. Please ensure you are in a well-lit room.
          </p>
          <div className="space-y-3 text-left mb-8 bg-[var(--surface2)] p-4 rounded-xl text-sm text-[var(--ink)]">
            <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Do not leave the full-screen mode.</p>
            <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Do not open new tabs or applications.</p>
            <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Ensure no one else is in the frame.</p>
          </div>
          <button 
            onClick={() => setHasStarted(true)}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20"
          >
            I Understand, Start Exam
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col md:flex-row">
      {/* LEFT: Exam Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
            <div>
              <h1 className="text-2xl font-bold">Midterm Examination</h1>
              <p className="text-gray-400 text-sm">Computer Science 101</p>
            </div>
            <div className="text-right">
              <div className="text-xl font-mono text-indigo-400">59:34</div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Time Remaining</p>
            </div>
          </div>

          <div className="bg-[#111] p-6 rounded-2xl border border-gray-800 mb-6">
            <h3 className="font-semibold text-lg mb-4">1. What is the primary purpose of a React useEffect hook?</h3>
            <div className="space-y-3">
              {["To render HTML", "To manage side effects in functional components", "To create a global state store", "To handle routing"].map((opt, i) => (
                <label key={i} className="flex items-center p-3 rounded-xl border border-gray-800 hover:border-indigo-500 hover:bg-indigo-500/5 cursor-pointer transition-all">
                  <input type="radio" name="q1" className="text-indigo-500 bg-black border-gray-700 mr-3" />
                  <span className="text-sm">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end mt-8">
            <button 
              onClick={() => router.push("/dashboard/student")}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/20"
            >
              Submit Exam
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: Proctor Sidebar */}
      <div className="w-full md:w-80 bg-[#111] border-l border-gray-800 flex flex-col h-screen shrink-0">
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <ShieldIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-sm">ProctorShield Active</h2>
        </div>
        
        {/* Webcam View */}
        <div className="p-4">
          <div className="relative rounded-xl overflow-hidden border-2 border-gray-800 bg-black aspect-video flex items-center justify-center">
            {!cameraActive && <p className="text-xs text-gray-500 animate-pulse">Initializing Camera...</p>}
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-[10px] font-bold text-emerald-400">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> REC
            </div>
          </div>
        </div>

        {/* AI Diagnostics & Demo Triggers */}
        <div className="p-4 flex-1">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">AI Diagnostics</h3>
          
          <div className="space-y-2 mb-6">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Face Detected</span>
              <span className="text-emerald-500 font-bold">Yes (99%)</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Gaze Tracking</span>
              <span className="text-emerald-500 font-bold">Focused</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Environment Audio</span>
              <span className="text-emerald-500 font-bold">Normal</span>
            </div>
          </div>

          <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl mb-6">
            <div className="flex items-center gap-2 text-red-400 font-bold text-xs mb-1">
              <AlertTriangle className="w-4 h-4" /> Violations Detected
            </div>
            <p className="text-2xl font-bold text-white">{violationCount}</p>
          </div>

          {/* DEMO BUTTONS FOR PRESENTATION */}
          <div className="pt-4 border-t border-gray-800">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 text-center">Panel Presentation Triggers</h3>
            <div className="space-y-2">
              <button 
                onClick={() => reportViolation("looking_away")}
                className="w-full py-2 text-xs font-semibold text-amber-500 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors"
              >
                Trigger "Look Away" Event
              </button>
              <button 
                onClick={() => reportViolation("multiple_faces")}
                className="w-full py-2 text-xs font-semibold text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                Trigger "Multiple Faces" Event
              </button>
              <p className="text-[10px] text-gray-500 text-center mt-2">
                (Try opening a new browser tab to trigger the automatic tab switch event!)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
