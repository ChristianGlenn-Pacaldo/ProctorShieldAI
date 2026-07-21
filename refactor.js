const fs = require('fs');
const path = require('path');

const replacements = [
  { from: /studentExams/g, to: 'studentQuizzes' },
  { from: /StudentExams/g, to: 'StudentQuizzes' },
  { from: /studentExamId/g, to: 'studentQuizId' },
  { from: /studentExam/g, to: 'studentQuiz' },
  { from: /StudentExam/g, to: 'StudentQuiz' },
  { from: /examStatus/g, to: 'quizStatus' },
  { from: /examType/g, to: 'quizType' },
  { from: /examId/g, to: 'quizId' },
  { from: /exams/g, to: 'quizzes' },
  { from: /Exams/g, to: 'Quizzes' },
  { from: /exam/g, to: 'quiz' },
  { from: /Exam/g, to: 'Quiz' },
  { from: /EXAM/g, to: 'QUIZ' }
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  for (const { from, to } of replacements) {
    content = content.replace(from, to);
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function processDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.jsx'))) {
      processFile(fullPath);
    }
  }
}

const targetDir = path.join(__dirname, 'prisma');
console.log(`Starting refactor in ${targetDir}...`);
processDirectory(targetDir);
console.log('Refactor complete.');
