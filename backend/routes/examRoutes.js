import express from "express";
import { getExams, createExam, joinExam } from "../controllers/examController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getExams);
router.post("/", protect, createExam);
router.post("/join", protect, joinExam);

export default router;
