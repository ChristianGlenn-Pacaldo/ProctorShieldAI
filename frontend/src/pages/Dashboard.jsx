import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API from "../api/axios";

export default function Dashboard() {
  const navigate = useNavigate();
  const userString = localStorage.getItem("user");
  const user = userString ? JSON.parse(userString) : null;
  const [exams, setExams] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [newExamTitle, setNewExamTitle] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchExams();
  }, []);

  const fetchExams = async () => {
    try {
      const res = await API.get("/exams");
      setExams(res.data.exams || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  const handleJoinExam = async (e) => {
    e.preventDefault();
    try {
      const res = await API.post("/exams/join", { accessCode: joinCode });
      setMessage(`✅ ${res.data.message}`);
      setJoinCode("");
      fetchExams();
    } catch (err) {
      setMessage(`❌ ${err.response?.data?.message || "Error joining exam"}`);
    }
  };

  const handleCreateExam = async (e) => {
    e.preventDefault();
    try {
      const res = await API.post("/exams", { title: newExamTitle, duration: 60 });
      setMessage(`✅ ${res.data.message}`);
      setNewExamTitle("");
      fetchExams();
    } catch (err) {
      setMessage(`❌ ${err.response?.data?.message || "Error creating exam"}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-blue-600">ProctorShield MERN</h1>
        <button onClick={handleLogout} className="text-sm font-medium text-gray-600 hover:text-gray-900">
          Logout
        </button>
      </nav>
      
      <main className="max-w-4xl mx-auto mt-8 p-6 bg-white rounded-lg shadow">
        <h2 className="text-2xl font-bold mb-4">Welcome back, {user?.fullName}!</h2>
        
        {message && <div className="mb-4 p-3 bg-blue-100 text-blue-800 rounded">{message}</div>}

        {user?.role === "teacher" ? (
          <div className="mb-8 p-4 border rounded-lg bg-gray-50">
            <h3 className="font-bold text-lg mb-2">Create New Exam</h3>
            <form onSubmit={handleCreateExam} className="flex gap-2">
              <input type="text" value={newExamTitle} onChange={(e) => setNewExamTitle(e.target.value)} placeholder="Exam Title (e.g. CS101 Midterm)" required className="flex-1 px-3 py-2 border rounded-md" />
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">Create</button>
            </form>
          </div>
        ) : (
          <div className="mb-8 p-4 border rounded-lg bg-gray-50">
            <h3 className="font-bold text-lg mb-2">Join Exam</h3>
            <form onSubmit={handleJoinExam} className="flex gap-2">
              <input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Access Code (e.g. PS-1234)" required className="flex-1 px-3 py-2 border rounded-md" />
              <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700">Join</button>
            </form>
          </div>
        )}

        <h3 className="font-bold text-xl mb-4 border-b pb-2">
          {user?.role === "teacher" ? "My Created Exams" : "My Enrolled Exams"}
        </h3>

        {exams.length === 0 ? (
          <p className="text-gray-500 italic">No exams found.</p>
        ) : (
          <div className="space-y-3">
            {exams.map((item) => {
              const exam = user?.role === "student" ? item.exam : item;
              return (
                <div key={item.id} className="p-4 border rounded shadow-sm flex justify-between items-center">
                  <div>
                    <h4 className="font-bold text-lg">{exam.title}</h4>
                    <p className="text-sm text-gray-500">Access Code: <strong>{exam.accessCode}</strong></p>
                  </div>
                  <span className="px-3 py-1 bg-gray-200 text-sm rounded-full font-medium">
                    {user?.role === "student" ? item.examStatus : exam.examStatus}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  );
}
