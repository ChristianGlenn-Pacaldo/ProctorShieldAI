import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { loadArenaModule } from "./arena-fixture.ts";
import * as identity from "../../src/lib/student-identity.ts";

const link = { __esModule: true, default: (props: React.ComponentProps<"a">) => React.createElement("a", props) };
const ArenaIdentity = loadArenaModule("src/components/arena/arena-identity.tsx", {
  "react/jsx-runtime": jsxRuntime, "lucide-react": icons, "@/lib/student-identity": identity,
}).ArenaIdentity;
const Podium = loadArenaModule("src/components/arena/arena-podium.tsx", {
  react: React, "react/jsx-runtime": jsxRuntime, "lucide-react": icons, "next/link": link,
  "./arena-identity": { ArenaIdentity },
}).ArenaPodium;
const Playground = loadArenaModule("src/app/dashboard/teacher/playground/content.tsx", {
  react: React, "react/jsx-runtime": jsxRuntime, "lucide-react": icons, "next/link": link,
  "next/navigation": { useRouter: () => ({ push() {} }) },
}).default;

export function podiumHtml() {
  const participants = [
    { studentId: "a", studentName: "QA Ada", initials: "QA", score: 1234, rank: 1 },
    { studentId: "b", studentName: "QA Bea", initials: "QB", score: 950, rank: 2 },
    { studentId: "c", studentName: "QA Cy", initials: "QC", score: 700, rank: 3 },
  ];
  return renderToStaticMarkup(React.createElement(Podium, {
    quizTitle: "Disposable UI Arena", subjectName: "QA", podium: participants,
    allParticipants: participants, currentStudentId: "a", studentScore: 1234, studentRank: 1,
    highestStreak: 7, expEarned: 100,
  }));
}

export function playgroundHtml(subscribed: boolean) {
  return renderToStaticMarkup(React.createElement(Playground, {
    isSubscribed: subscribed, planName: subscribed ? "Premium" : "Free", teacherId: "teacher",
    teacherName: "QA Teacher", quizzes: [],
  }));
}

export function quizCompletionHtml(violations = 0) {
  const filename = "src/app/quiz/[id]/page.tsx";
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let branch: ts.IfStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "quizSubmittedResult") branch = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!branch) throw new Error("Quiz completion branch missing");
  const exports: { render?: (result: unknown) => React.ReactNode } = {};
  const code = ts.transpileModule(`export function render(quizSubmittedResult: any) ${branch.thenStatement.getText(source)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, ...icons, router: { push() {} },
    require: (name: string) => { if (name === "react/jsx-runtime") return jsxRuntime; throw new Error(name); },
  });
  return renderToStaticMarkup(exports.render!({ score: violations >= 3 ? null : 75, total: 4,
    answeredCount: 3, totalQuestions: 4, violations, integrityInvalidated: violations >= 3,
    aiVerdict: violations >= 3 ? "cheated" : violations ? "suspicious" : "clean", expEarned: 100 }));
}
