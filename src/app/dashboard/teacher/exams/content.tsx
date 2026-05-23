"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Search, Sparkles, Camera, Upload, Trash, Check } from "lucide-react";

export default function TeacherExamsPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Exam Creation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newExamForm, setNewExamForm] = useState({
    title: "",
    subjectName: "",
    description: "",
    duration: 60,
    totalQuestions: 10,
    shuffleQuestions: true
  });

  // AI Modal State
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "upload" | "webcam">("text");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [aiGeneratedQuestions, setAiGeneratedQuestions] = useState<any[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Manage Exam Modal State
  const [manageExam, setManageExam] = useState<any | null>(null);
  const [manageExamDetails, setManageExamDetails] = useState<any>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Stop camera helper
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  // Webcam stream lifecycle
  useEffect(() => {
    if (isAiModalOpen && activeTab === "webcam" && !capturedImage) {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(s => {
          setStream(s);
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
        })
        .catch(err => {
          console.error("Error accessing camera:", err);
        });
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isAiModalOpen, activeTab, capturedImage]);

  // Load exam details (questions/choices) when managing an exam
  useEffect(() => {
    if (!manageExam) {
      setManageExamDetails(null);
      return;
    }
    const fetchDetails = async () => {
      try {
        const res = await fetch(`/api/exams/${manageExam.id}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setManageExamDetails({
            ...data.exam,
            questions: data.questions
          });
        }
      } catch (err) {
        console.error("Failed to fetch exam details:", err);
      }
    };
    fetchDetails();
  }, [manageExam]);

  const toggleExamStatus = async (exam: any) => {
    setIsUpdatingStatus(true);
    const newStatus = exam.examStatus === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/api/exams/${exam.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examStatus: newStatus })
      });
      if (res.ok) {
        setManageExam({ ...exam, examStatus: newStatus });
        fetchExams(); // refresh list
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, 640, 480);
      const base64 = canvas.toDataURL("image/jpeg", 0.85);
      setCapturedImage(base64);
      stopCamera();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const splitBase64 = (dataUrl: string) => {
    const parts = dataUrl.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const raw = parts[1];
    return { mime, raw };
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAiGenerating(true);
    setCreateError("");

    try {
      let body: any = { numQuestions: 10 };
      if (activeTab === "text") {
        if (!aiTopic) {
          alert("Please enter a topic.");
          setIsAiGenerating(false);
          return;
        }
        body.topic = aiTopic;
      } else if (activeTab === "upload") {
        if (!uploadedImage) {
          alert("Please upload an image.");
          setIsAiGenerating(false);
          return;
        }
        const { mime, raw } = splitBase64(uploadedImage);
        body.imageBase64 = raw;
        body.mimeType = mime;
      } else if (activeTab === "webcam") {
        if (!capturedImage) {
          alert("Please capture an image.");
          setIsAiGenerating(false);
          return;
        }
        const { mime, raw } = splitBase64(capturedImage);
        body.imageBase64 = raw;
        body.mimeType = mime;
      }

      const res = await fetch("/api/ai/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "AI generation failed");
      }

      setAiGeneratedQuestions(data.questions);

      const displayTopic = activeTab === "text" ? aiTopic : (activeTab === "upload" ? "Uploaded Document" : "Captured Document");
      setNewExamForm({
        title: `AI Assessment - ${displayTopic.slice(0, 30)}`,
        subjectName: activeTab === "text" ? aiTopic.slice(0, 30) : "AI Generated",
        description: `This exam was auto-generated by ProctorShield AI based on: ${displayTopic}.`,
        duration: 60,
        totalQuestions: data.questions.length,
        shuffleQuestions: true
      });

      setIsAiModalOpen(false);
      setIsCreateModalOpen(true);
      
      // Reset inputs
      setAiTopic("");
      setUploadedImage(null);
      setCapturedImage(null);
      setActiveTab("text");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "An error occurred while generating questions");
    } finally {
      setIsAiGenerating(false);
    }
  };

  const fetchExams = async () => {
    try {
      const res = await fetch("/api/exams");
      if (res.ok) {
        const data = await res.json();
        setExams(data.exams);
      }
    } catch (error) {
      console.error("Failed to fetch exams", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch exams from our backend API
  useEffect(() => {
    fetchExams();
  }, []);

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setIsCreating(true);

    try {
      const res = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newExamForm,
          questions: aiGeneratedQuestions
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.message || data.error || "Failed to create exam");
        setIsCreating(false);
        return;
      }

      // Success! Close modal, reset form, refresh exams
      setIsCreateModalOpen(false);
      setAiGeneratedQuestions([]);
      setNewExamForm({
        title: "",
        subjectName: "",
        description: "",
        duration: 60,
        totalQuestions: 10,
        shuffleQuestions: true
      });
      fetchExams();
    } catch (err) {
      setCreateError("Network error. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = exams.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">📝 My Created Exams</h3>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted2)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exams..."
                className="w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface2)] border border-[var(--border)] text-[var(--ink)] placeholder:text-[var(--muted2)] focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <button 
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-violet-500/30 text-violet-500 hover:bg-violet-500/10 transition-all">
              <Sparkles className="w-3.5 h-3.5" /> AI Create
            </button>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-all">
              <Plus className="w-3.5 h-3.5" /> New Exam
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-[var(--muted)]">
              <span className="text-2xl mb-2">📄</span>
              <p className="text-sm font-semibold">No exams found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Exam Title", "Subject", "Join Code", "Questions", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--surface2)] transition-colors">
                    <td className="px-5 py-3">
                      <div className="text-sm font-semibold text-[var(--ink)]">{e.title}</div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">{e.duration} mins</div>
                    </td>
                    <td className="px-5 py-3 text-sm text-[var(--muted)]">{e.subject?.subjectName || "N/A"}</td>
                    <td className="px-5 py-3"><code className="px-2 py-1 bg-indigo-500/10 text-indigo-500 rounded-md font-mono font-bold text-xs">{e.accessCode}</code></td>
                    <td className="px-5 py-3 text-sm text-[var(--ink)]">{e.totalQuestions}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                        e.examStatus === 'active' ? 'bg-emerald-500/15 text-emerald-600' : 
                        e.examStatus === 'draft' ? 'bg-amber-500/15 text-amber-600' : 
                        'bg-slate-500/15 text-slate-400'
                      }`}>
                        {e.examStatus.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={() => setManageExam(e)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface2)] hover:text-indigo-500 transition-all">Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* CREATE EXAM MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)]">
              <h2 className="text-lg font-bold text-[var(--ink)]">Create New Exam</h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-[var(--muted)] hover:text-white transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleCreateExam} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                  {createError}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Exam Title *</label>
                <input required type="text" value={newExamForm.title} onChange={e => setNewExamForm({...newExamForm, title: e.target.value})} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" placeholder="e.g. Midterm Examination" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Subject Name *</label>
                <input required type="text" value={newExamForm.subjectName} onChange={e => setNewExamForm({...newExamForm, subjectName: e.target.value})} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" placeholder="e.g. Computer Science 101" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Description</label>
                <textarea value={newExamForm.description} onChange={e => setNewExamForm({...newExamForm, description: e.target.value})} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 min-h-[80px]" placeholder="Optional description..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Duration (mins)</label>
                  <input required type="number" min="5" value={newExamForm.duration} onChange={e => setNewExamForm({...newExamForm, duration: parseInt(e.target.value)})} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Total Questions</label>
                  <input required type="number" min="1" value={newExamForm.totalQuestions} onChange={e => setNewExamForm({...newExamForm, totalQuestions: parseInt(e.target.value)})} className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500" />
                </div>
              </div>

              <div className="flex items-center gap-2 py-1">
                <input 
                  type="checkbox" 
                  id="shuffleQuestions"
                  checked={newExamForm.shuffleQuestions} 
                  onChange={e => setNewExamForm({...newExamForm, shuffleQuestions: e.target.checked})}
                  className="w-4 h-4 rounded bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 text-indigo-600 focus:ring-0 cursor-pointer" 
                />
                <label htmlFor="shuffleQuestions" className="text-xs font-semibold text-[var(--ink)] cursor-pointer select-none">
                  Shuffle Questions per Student
                </label>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-2 rounded-lg font-semibold text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#222] transition-all">Cancel</button>
                <button type="submit" disabled={isCreating} className="flex-1 py-2 rounded-lg font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50">
                  {isCreating ? "Creating..." : "Create Exam"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI GENERATE MODAL */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-indigo-500/10 opacity-50 pointer-events-none" />
            
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)] relative z-10">
              <h2 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" /> Auto-Generate with AI
              </h2>
              <button 
                onClick={() => { setIsAiModalOpen(false); stopCamera(); }} 
                className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Input Selection Tabs */}
            <div className="px-6 py-2 border-b border-[var(--border)] flex gap-4 bg-[var(--surface2)] relative z-10 text-xs font-bold text-[var(--muted)]">
              <button 
                type="button"
                onClick={() => { setActiveTab("text"); stopCamera(); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "text" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                Text Topic
              </button>
              <button 
                type="button"
                onClick={() => { setActiveTab("upload"); stopCamera(); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "upload" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File
              </button>
              <button 
                type="button"
                onClick={() => { setActiveTab("webcam"); }}
                className={`pb-2 border-b-2 transition-all flex items-center gap-1 ${activeTab === "webcam" ? "border-violet-500 text-violet-500 font-bold" : "border-transparent"}`}
              >
                <Camera className="w-3.5 h-3.5" /> Webcam Capture
              </button>
            </div>
            
            <form onSubmit={handleAiGenerate} className="p-6 space-y-4 relative z-10">
              <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
                Provide a topic description, upload a document page, or use your webcam to capture questions. ProctorShield AI will instantly structure and generate your exam.
              </p>

              {activeTab === "text" && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink)] mb-1.5">Exam Topic / Subject *</label>
                  <textarea 
                    required 
                    value={aiTopic} 
                    onChange={e => setAiTopic(e.target.value)} 
                    className="w-full px-3 py-2 bg-white dark:bg-[#111] border border-gray-300 dark:border-gray-800 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:border-violet-500 min-h-[100px]" 
                    placeholder="e.g. Advanced Data Structures and Algorithms in Java" 
                  />
                </div>
              )}

              {activeTab === "upload" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">Upload Material Image *</label>
                  {!uploadedImage ? (
                    <div className="border-2 border-dashed border-[var(--border)] hover:border-violet-500/50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer relative bg-[var(--surface2)]">
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleFileUpload} 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                      />
                      <Upload className="w-8 h-8 text-[var(--muted)] mb-2" />
                      <span className="text-xs text-[var(--muted)] text-center">Drag & drop or click to upload syllabus/notes image</span>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img src={uploadedImage} alt="Uploaded preview" className="w-full max-h-[180px] object-contain rounded-lg" />
                      <button 
                        type="button" 
                        onClick={() => setUploadedImage(null)} 
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "webcam" && (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--ink)]">Capture Material from Webcam *</label>
                  {!capturedImage ? (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black aspect-video flex items-center justify-center">
                      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <button 
                        type="button" 
                        onClick={handleCapture}
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-lg shadow-violet-600/30 transition-all"
                      >
                        <Camera className="w-4 h-4" /> Capture Photo
                      </button>
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-black/40 p-2">
                      <img src={capturedImage} alt="Captured preview" className="w-full max-h-[180px] object-contain rounded-lg" />
                      <button 
                        type="button" 
                        onClick={() => setCapturedImage(null)} 
                        className="absolute top-4 right-4 bg-red-500/90 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => { setIsAiModalOpen(false); stopCamera(); }} 
                  className="flex-1 py-2 rounded-lg font-semibold text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#222] transition-all"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isAiGenerating} className="flex-1 py-2 rounded-lg font-semibold text-sm bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 transition-all shadow-lg shadow-violet-600/20 disabled:opacity-50 flex justify-center items-center gap-2">
                  {isAiGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Generate Magic
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANAGE EXAM MODAL */}
      {manageExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface2)]">
              <h2 className="text-lg font-bold text-[var(--ink)]">Manage Exam</h2>
              <button onClick={() => setManageExam(null)} className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors">✕</button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-xl font-bold text-[var(--ink)] mb-1">{manageExam.title}</h3>
                <p className="text-sm text-[var(--muted)]">{manageExam.subject?.subjectName || "No Subject"}</p>
              </div>

              <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-4 flex flex-col items-center justify-center space-y-2">
                <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">Share this code with students</span>
                <div className="flex items-center gap-3">
                  <code className="text-2xl font-mono font-bold text-indigo-500 tracking-wider">
                    {manageExam.accessCode}
                  </code>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(manageExam.accessCode);
                      alert("Join code copied to clipboard!");
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Questions</div>
                  <div className="text-lg font-semibold text-[var(--ink)]">{manageExam.totalQuestions}</div>
                </div>
                <div className="border border-[var(--border)] rounded-xl p-3">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase">Duration</div>
                  <div className="text-lg font-semibold text-[var(--ink)]">{manageExam.duration} mins</div>
                </div>
              </div>

              {/* Display questions and choices with correct answer highlighted */}
              {manageExamDetails ? (
                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1 border-t border-[var(--border)] pt-4">
                  <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider flex items-center justify-between">
                    <span>Generated Questions</span>
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-500 px-2 py-0.5 rounded-full normal-case font-semibold">
                      {manageExamDetails.shuffleQuestions ? 'Shuffled' : 'Standard'}
                    </span>
                  </h4>
                  {manageExamDetails.questions && manageExamDetails.questions.length > 0 ? (
                    manageExamDetails.questions.map((q: any, qi: number) => (
                      <div key={q.id} className="p-3 bg-[var(--surface2)] border border-[var(--border)] rounded-xl text-xs space-y-1.5">
                        <div className="font-bold text-[var(--ink)]">{qi + 1}. {q.questionText}</div>
                        <div className="grid grid-cols-2 gap-2 pl-2">
                          {q.choices.map((c: any) => (
                            <div key={c.id} className={`flex items-center gap-1 ${c.isCorrect ? 'text-emerald-500 font-bold' : 'text-[var(--muted)]'}`}>
                              <span className="shrink-0">{c.isCorrect ? '✓' : '•'}</span>
                              <span className="truncate">{c.choiceText}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-[var(--muted)] italic">No questions found for this exam.</div>
                  )}
                </div>
              ) : (
                <div className="flex justify-center py-4 border-t border-[var(--border)]">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <div className="pt-2 border-t border-[var(--border)] flex justify-between items-center">
                <div className="text-sm text-[var(--muted)] font-medium">Exam Status:</div>
                <button
                  onClick={() => toggleExamStatus(manageExam)}
                  disabled={isUpdatingStatus}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    manageExam.examStatus === "active" 
                      ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" 
                      : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                  }`}
                >
                  {isUpdatingStatus ? "Updating..." : manageExam.examStatus === "active" ? "Set to Draft" : "Make Active"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
