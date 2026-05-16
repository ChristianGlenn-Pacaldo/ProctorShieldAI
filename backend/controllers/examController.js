import prisma from "../config/db.js";

// @desc    Get all exams for user (Teacher or Student)
// @route   GET /api/exams
export const getExams = async (req, res) => {
  try {
    const { id, role } = req.user;

    if (role === "teacher") {
      const exams = await prisma.exam.findMany({
        where: { teacherId: id },
        include: { subject: true },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ exams });
    } else if (role === "student") {
      const studentExams = await prisma.studentExam.findMany({
        where: { studentId: id },
        include: { exam: { include: { subject: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ exams: studentExams });
    }

    res.status(403).json({ message: "Invalid role" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Create an exam (Teacher only)
// @route   POST /api/exams
export const createExam = async (req, res) => {
  try {
    if (req.user.role !== "teacher") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const { subjectId, title, duration, totalQuestions } = req.body;
    const accessCode = `PS-${Math.floor(1000 + Math.random() * 9000)}`;

    // Fallback subject logic if none exists for demo purposes
    let subId = subjectId;
    if (!subId) {
      const defaultSubject = await prisma.subject.findFirst({ where: { teacherId: req.user.id } });
      if (defaultSubject) {
        subId = defaultSubject.id;
      } else {
        const newSubject = await prisma.subject.create({
          data: { teacherId: req.user.id, subjectName: "General Subject" },
        });
        subId = newSubject.id;
      }
    }

    const exam = await prisma.exam.create({
      data: {
        teacherId: req.user.id,
        subjectId: subId,
        title,
        accessCode,
        duration: duration || 60,
        totalQuestions: totalQuestions || 10,
        examStatus: "draft",
      },
    });

    res.status(201).json({ message: "Exam created", exam });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Join an exam via code (Student only)
// @route   POST /api/exams/join
export const joinExam = async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const { accessCode } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { accessCode: accessCode.toUpperCase() },
      include: { subject: true },
    });

    if (!exam) {
      return res.status(404).json({ message: "Invalid access code" });
    }

    const existing = await prisma.studentExam.findFirst({
      where: { studentId: req.user.id, examId: exam.id },
    });

    if (existing) {
      return res.status(400).json({ message: "Already joined this exam" });
    }

    const studentExam = await prisma.studentExam.create({
      data: {
        studentId: req.user.id,
        examId: exam.id,
        examStatus: "enrolled",
      },
    });

    res.status(201).json({ message: `Successfully joined ${exam.title}`, exam: studentExam });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
