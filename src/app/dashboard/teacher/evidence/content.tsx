"use client";

import { useState, useEffect, useCallback } from "react";
import { Camera, AlertCircle, PlayCircle, Download, Trash2 } from "lucide-react";

interface EvidenceItem {
  id: string;
  name: string;
  quizTitle: string;
  event: string;
  violationType: string | null;
  timestamp: string;
  bg: string;
  btnClass: string;
  screenshotPath: string | null;
  evidenceType: string | null;
  durationSeconds: number | null;
}

function isVideoEvidence(evidence: EvidenceItem): boolean {
  return evidence.evidenceType?.startsWith("video/") === true
    || evidence.screenshotPath?.startsWith("data:video/") === true
    || evidence.screenshotPath?.endsWith(".webm") === true
    || evidence.screenshotPath?.endsWith(".mp4") === true;
}

export default function EvidenceContent({ teacherId }: { teacherId: string }) {
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearCache = async () => {
    if (!confirm("Are you sure you want to purge all evidence logs and video clips from the database? This will free up storage space on Neon DB.")) return;

    try {
      setIsClearing(true);
      const res = await fetch("/api/dashboard/teacher/evidence", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setEvidenceList([]);
        setSelectedEvidence(null);
        alert(data.message || "Evidence storage successfully cleared from database!");
      } else {
        alert("Failed to clear evidence storage: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Clear evidence cache failed:", err);
      alert("Error clearing evidence cache");
    } finally {
      setIsClearing(false);
    }
  };

  const fetchEvidence = useCallback(async (background = false) => {
    try {
      const res = await fetch("/api/dashboard/teacher/evidence");
      if (res.ok) {
        const data = await res.json();
        const nextEvidence: EvidenceItem[] = data.evidence || [];
        setEvidenceList(nextEvidence);
        setSelectedEvidence((current) => {
          if (current) return nextEvidence.find((item) => item.id === current.id) || nextEvidence[0] || null;
          return nextEvidence[0] || null;
        });
      }
    } catch (err) {
      console.error("Failed to fetch evidence logs:", err);
    } finally {
      if (!background) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teacherId && teacherId !== "unknown") {
      void fetchEvidence();
      // A clip takes four seconds to record. Refresh in the background so a
      // snapshot already visible to the teacher is replaced by its video.
      const refreshTimer = window.setInterval(() => void fetchEvidence(true), 5_000);
      return () => window.clearInterval(refreshTimer);
    }
  }, [teacherId, fetchEvidence]);

  const handleDownload = () => {
    if (!selectedEvidence || !selectedEvidence.screenshotPath) return;
    
    // Trigger base64 download
    const link = document.createElement("a");
    link.href = selectedEvidence.screenshotPath.startsWith("/api/evidence/")
      ? `${selectedEvidence.screenshotPath}?download=1`
      : selectedEvidence.screenshotPath;
    const extension = isVideoEvidence(selectedEvidence)
      ? selectedEvidence.evidenceType === "video/mp4" ? "mp4" : "webm"
      : "jpg";
    link.download = `evidence_${selectedEvidence.name.replace(/\s+/g, "_")}_${selectedEvidence.id}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Evidence Log */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="text-sm font-bold text-[var(--ink)]">📸 Evidence Log</h3>
          {evidenceList.length > 0 && (
            <button
              onClick={handleClearCache}
              disabled={isClearing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold text-xs transition-all border border-rose-500/20 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> {isClearing ? "Clearing DB..." : "Clear Storage & DB Cache"}
            </button>
          )}
        </div>
        
        <div className="divide-y divide-[var(--border)] min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : evidenceList.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center h-[300px] text-[var(--muted)]">
              <AlertCircle className="w-10 h-10 mb-3 text-[var(--muted2)]" />
              <p className="text-sm font-semibold">No proctoring violations recorded</p>
              <p className="text-xs text-[var(--muted2)] mt-0.5">
                Violations caught during student quizzes will appear here as evidence logs.
              </p>
            </div>
          ) : (
            evidenceList.map((e) => (
              <div
                key={e.id}
                onClick={() => setSelectedEvidence(e)}
                className={`flex items-center justify-between px-5 py-4 cursor-pointer transition-all ${
                  selectedEvidence?.id === e.id
                    ? "bg-indigo-500/10 border-l-4 border-indigo-500"
                    : e.bg
                } hover:bg-indigo-500/5`}
              >
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">{e.name}</div>
                  <div className="text-xs font-semibold text-[var(--muted)] mt-0.5">{e.quizTitle}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1">{e.event}</div>
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEvidence(e);
                    setIsFullscreen(true);
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all ${e.btnClass}`}
                >
                  <PlayCircle className="w-3.5 h-3.5" /> View
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Video Player / Snapshot View */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">🖼️ Integrity Evidence Viewer</h3>
        </div>
        
        <div className="p-5 text-center min-h-[300px] flex flex-col justify-between">
          {selectedEvidence ? (
            <div className="space-y-4">
              <div 
                className="relative w-full h-64 bg-slate-900 rounded-xl overflow-hidden border border-[var(--border)] flex items-center justify-center text-white text-sm cursor-pointer group"
                onClick={() => {
                  if (selectedEvidence.screenshotPath) setIsFullscreen(true);
                }}
              >
                {selectedEvidence.screenshotPath ? (
                  isVideoEvidence(selectedEvidence) ? (
                    <video
                      src={selectedEvidence.screenshotPath}
                      controls
                      preload="metadata"
                      playsInline
                      aria-label={`Violation evidence video for ${selectedEvidence.name}`}
                      className="w-full h-full object-contain rounded-lg"
                    >
                      Your browser does not support evidence video playback.
                    </video>
                  ) : (
                    <>
                      <img
                        src={selectedEvidence.screenshotPath}
                        alt={`Evidence: ${selectedEvidence.name}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="bg-black/60 px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest backdrop-blur-sm">CLICK TO ENLARGE</span>
                      </div>
                    </>
                  )
                ) : (
                  <div className="flex flex-col items-center gap-2 text-[var(--muted2)]">
                    <Camera className="w-12 h-12" />
                    <span className="text-xs">No webcam evidence captured for this violation</span>
                  </div>
                )}
                {/* Overlay Badge */}
                <div className="absolute top-3 left-3 bg-red-600 text-white font-bold text-[9px] px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 shadow-md">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" /> Flagged Incidents
                </div>
              </div>
              
              <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-4 text-left space-y-2">
                <div className="flex justify-between items-center border-b border-[var(--border)] pb-2">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase">Student</span>
                  <span className="text-sm font-bold text-[var(--ink)]">{selectedEvidence.name}</span>
                </div>
                <div className="flex justify-between items-center border-b border-[var(--border)] pb-2">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase">Quiz</span>
                  <span className="text-xs font-semibold text-[var(--ink)] truncate max-w-[200px]">{selectedEvidence.quizTitle}</span>
                </div>
                <div className="flex justify-between items-center border-b border-[var(--border)] pb-2">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase">Incident Details</span>
                  <span className="text-xs font-semibold text-red-500">{selectedEvidence.event.split("·")[0].trim()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase">Date & Time</span>
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    {new Date(selectedEvidence.timestamp).toLocaleString()}
                  </span>
                </div>
                {isVideoEvidence(selectedEvidence) && (
                  <div className="flex justify-between items-center border-t border-[var(--border)] pt-2">
                    <span className="text-xs font-bold text-[var(--muted)] uppercase">Evidence Clip</span>
                    <span className="text-xs font-semibold text-blue-500">{selectedEvidence.durationSeconds || 4} seconds</span>
                  </div>
                )}
              </div>

              {selectedEvidence.screenshotPath && (
                <button
                  onClick={handleDownload}
                  className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5"
                >
                  <Download className="w-4 h-4" /> Download Evidence {isVideoEvidence(selectedEvidence) ? "Video" : "Image"}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--muted)]">
              <PlayCircle className="w-12 h-12 mb-3 text-[var(--muted2)]" />
              <p className="text-sm font-semibold">Select an incident to view evidence</p>
              <p className="text-xs text-[var(--muted2)] mt-0.5">
                Detailed snapshots will load here on demand
              </p>
            </div>
          )}
        </div>
      </div>
      {/* FULLSCREEN REPLAY MODAL */}
      {isFullscreen && selectedEvidence && (
        <div 
          className="app-modal-backdrop bg-black/90 backdrop-blur-md animate-fade-in"
          onClick={() => setIsFullscreen(false)}
        >
          <div 
            className="app-modal-panel min-h-0 max-w-5xl bg-[#111] rounded-2xl overflow-hidden border border-gray-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-800 bg-[#0a0a0a] px-4 py-3 sm:items-center sm:px-6 sm:py-4">
              <div className="min-w-0">
                <h2 className="flex min-w-0 items-center gap-2 text-base font-bold text-white sm:text-lg">
                  <Camera className="w-5 h-5 text-indigo-400" />
                  Evidence Replay — {selectedEvidence.name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{selectedEvidence.event}</p>
              </div>
              <button 
                onClick={() => setIsFullscreen(false)} 
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="relative flex min-h-[35vh] min-w-0 flex-1 items-center justify-center overflow-hidden bg-black p-2 sm:min-h-[50vh] sm:p-4">
              {selectedEvidence.screenshotPath ? (
                isVideoEvidence(selectedEvidence) ? (
                  <video
                    src={selectedEvidence.screenshotPath}
                    controls
                    autoPlay
                    preload="metadata"
                    playsInline
                    aria-label={`Violation evidence replay for ${selectedEvidence.name}`}
                    className="max-w-full max-h-full object-contain rounded border border-gray-800 shadow-2xl"
                  >
                    Your browser does not support evidence video playback.
                  </video>
                ) : (
                  <img
                    src={selectedEvidence.screenshotPath}
                    alt={`Evidence: ${selectedEvidence.name}`}
                    className="max-w-full max-h-full object-contain rounded border border-gray-800 shadow-2xl"
                  />
                )
              ) : (
                <p className="text-gray-500">No evidence available</p>
              )}
            </div>
            
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-800 bg-[#0a0a0a] p-3 sm:flex-row sm:justify-end sm:gap-3 sm:p-4">
              <button 
                onClick={handleDownload}
                disabled={!selectedEvidence.screenshotPath}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 sm:w-auto"
              >
                <Download className="w-4 h-4" /> Download
              </button>
              <button 
                onClick={() => setIsFullscreen(false)} 
                className="w-full rounded-xl border border-gray-700 bg-[#222] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#333] sm:w-auto"
              >
                Close Replay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
