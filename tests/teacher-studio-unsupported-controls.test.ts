import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const editorPath = path.resolve(process.cwd(), "src/components/teacher/proctorshield-quiz-editor.tsx");
const editorSource = fs.readFileSync(editorPath, "utf8");
const sourceFile = ts.createSourceFile(editorPath, editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findCallback(name: string) {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name && node.initializer && ts.isArrowFunction(node.initializer)) {
      callback = node.initializer.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(callback, `${name} must remain available`);
  return callback;
}

test("Studio exposes no editable per-question timer, explanation, or false timer badges", () => {
  const renderedExpressions: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression) renderedExpressions.push(node.expression.getText(sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(renderedExpressions.every((expression) => !/timeLimitSeconds|\.explanation\b/.test(expression)));
  assert.doesNotMatch(editorSource, /TIME_OPTIONS|Time Limit Selector|Explanation \(Optional\)|shown to students during result review/);
  assert.doesNotMatch(editorSource, /<Timer\b|<HelpCircle\b/);
});

test("quiz-wide duration settings and save payload remain available", () => {
  assert.match(editorSource, /Exam Duration \(Minutes\)/);
  assert.match(editorSource, /Match Duration \(Minutes\)/);
  assert.match(editorSource, /value=\{quizForm\.duration\}/);
  assert.match(editorSource, /setQuizForm\(\{ \.\.\.quizForm, duration:/);
  assert.match(findCallback("handleSaveAndPublish"), /!isDurationLocked \? \{ duration: quizForm\.duration \}/);
});

test("question draft still updates text, points, and choices", () => {
  const callback = findCallback("handleSaveQuestionDraft");
  const output = ts.transpileModule(`exports.saveQuestion = ${callback};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { saveQuestion?: () => void } = {};
  let questions = [{ questionText: "Before", points: 1, choices: [{ choiceText: "Old", isCorrect: true }] }];
  let studioMode = "question_studio";
  vm.runInNewContext(output, {
    exports,
    isContentLocked: false,
    draftQuestion: {
      questionText: "After",
      questionType: "multiple_choice",
      points: 5,
      choices: [{ choiceText: "New", isCorrect: true }, { choiceText: "Other", isCorrect: false }],
    },
    activeQuestionIndex: 0,
    setQuizForm: (update: (previous: { questions: typeof questions }) => { questions: typeof questions }) => {
      questions = update({ questions }).questions;
    },
    setStudioMode: (mode: string) => { studioMode = mode; },
    alert: (message: string) => { throw new Error(message); },
  });

  exports.saveQuestion?.();
  assert.equal(questions[0].questionText, "After");
  assert.equal(questions[0].points, 5);
  assert.equal(questions[0].choices[0].choiceText, "New");
  assert.equal(studioMode, "quiz_overview");
  assert.match(editorSource, /onClick=\{handleSaveQuestionDraft\}/);
});
