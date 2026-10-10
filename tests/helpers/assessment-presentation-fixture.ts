import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import * as devices from "../../src/lib/device-capabilities.ts";
import * as runtime from "../../src/lib/proctored-runtime.ts";
import * as identity from "../../src/lib/student-identity.ts";
import { loadArenaModule } from "./arena-fixture.ts";

// Controlled real-component presentation only. Effects, timers, API calls and
// camera inference never run here. This is not authenticated gameplay QA.
export function assessmentFixture(scene: "exam" | "arena", variant = "active", mobile = false) {
  const file = scene === "exam" ? "src/app/quiz/[id]/page.tsx" : "src/app/arena/[id]/content.tsx";
  const name = scene === "exam" ? "QuizAttempt" : "ArenaContent";
  let source = fs.readFileSync(file, "utf8");
  if (scene === "exam") source = source.replace("function QuizAttempt(", "export function QuizAttempt(");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const names = component.body!.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap(d => ts.isArrayBindingPattern(d.name) && d.initializer && ts.isCallExpression(d.initializer) && d.initializer.expression.getText(ast) === "useState" ? [d.name.elements[0].getText(ast)] : []) : []);
  const questions = [{ id: 1, questionText: "Which number is even?", questionType: "multiple_choice", points: scene === "exam" ? 1 : 100, choices: [{ id: 11, choiceText: "Two" }, { id: 12, choiceText: "Three" }] }, { id: 2, questionText: "Which shape has three sides?", questionType: "multiple_choice", points: 1, choices: [{ id: 21, choiceText: "Triangle" }, { id: 22, choiceText: "Circle" }] }];
  const state: Record<string, any> = { hasStarted: variant !== "lobby", cameraActive: true, timeLeft: 754,
    aiStatus: "Active ✓", faceStatus: "Detected ✓", gazeStatus: "Focused ✓", deviceStatus: "Scanning ✓", audioStatus: "Active ✓", isMobile: mobile,
    monitoringLevel: "strict", preflightPassed: true, loadingQuiz: false, canEnterQuiz: true, questions, quiz: { title: "Fixture Assessment", duration: 30, subject: { subjectName: "QA" } },
    phase: variant === "lobby" ? "lobby" : variant === "podium" ? "ended" : "in_wave", matchTimeLeft: 754, score: 213, studentRank: 2, totalParticipants: 3,
    hasGuardianShield: variant === "shield", activeAttackEffect: variant === "meteor" ? { type: "meteor", visualId: "fixture-meteor" } : null,
    leaderboard: [{ studentId: "student", studentName: "Fixture Student", score: 213, rank: 1, initials: "FS" }],
    battleInventory: { meteor: true, earthquake: true, blizzard: true, shield: true }, usedPowers: { meteor: false, earthquake: false, blizzard: false, shield: false },
  };
  if (variant === "warning") state.warningModal = { show: true, message: "Fixture security warning — unchanged three-strike behavior", isFinal: false };
  if (variant === "result") state.quizSubmittedResult = { score: 85, total: 2, answeredCount: 2, totalQuestions: 2, violations: 0, integrityInvalidated: false, aiVerdict: "clean" };
  const values = new Map(Object.entries(state)); let index = 0;
  const react = { ...React, useEffect() {}, useCallback: (fn: any) => fn, useRef: (current: any) => ({ current }),
    useState: (initial: any) => { const key = names[index++]; if (!key) throw Error("Unexpected state hook"); if (!values.has(key)) values.set(key, typeof initial === "function" ? initial() : initial); return [values.get(key), (next: any) => values.set(key, next)]; } };
  const ArenaIdentity = loadArenaModule("src/components/arena/arena-identity.tsx", { "react/jsx-runtime": jsx, "lucide-react": icons, "@/lib/student-identity": identity }).ArenaIdentity;
  const loadChild = (file: string, extra: Record<string, any> = {}) => loadArenaModule(file, { react: React, "react/jsx-runtime": jsx, "lucide-react": icons, "next/link": { __esModule: true, default: "a" }, "@/components/arena/arena-identity": { ArenaIdentity }, "./arena-identity": { ArenaIdentity }, ...extra });
  const ArenaEffects = loadChild("src/components/arena/arena-effects.tsx", { "./arena-effects.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } }).ArenaEffects;
  const ArenaBattleDock = loadChild("src/components/arena/arena-battle-dock.tsx").ArenaBattleDock;
  const ArenaPodium = loadChild("src/components/arena/arena-podium.tsx").ArenaPodium;
  const AuthThemeControl = loadArenaModule("src/components/auth-theme-control.tsx", { react: React, "react/jsx-runtime": jsx, "lucide-react": icons, "@/lib/theme-presentation": { syncSystemTheme() {}, togglePresentationTheme() {} } }).default;
  const AssessmentThemeControl = loadArenaModule("src/components/assessment-theme-control.tsx", { "react/jsx-runtime": jsx, "./auth-theme-control": { __esModule: true, default: AuthThemeControl } }).default;
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    exports, console, Map, Set, Date, Promise, AbortController, process: { env: {} },
    require: (name: string) => {
      if (name === "@/components/assessment-theme-control") return { __esModule: true, default: AssessmentThemeControl };
      if (name === "react") return react; if (name === "react/jsx-runtime") return jsx; if (name === "lucide-react") return icons;
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }), useParams: () => ({ id: "77" }) };
      if (name === "@/lib/device-capabilities") return devices; if (name === "@/lib/proctored-runtime") return runtime; if (name === "@/lib/student-identity") return identity;
      if (name === "@/components/arena/arena-identity") return { ArenaIdentity }; if (name === "@/components/arena/arena-effects") return { ArenaEffects };
      if (name === "@/components/arena/arena-battle-dock") return { ArenaBattleDock }; if (name === "@/components/arena/arena-podium") return { ArenaPodium };
      if (name === "pusher-js") return { __esModule: true, default: class {} };
      return {};
    },
  }, { filename: file });
  index = 0;
  const view = scene === "exam" ? exports.QuizAttempt({ quizId: "77" }) : exports.ArenaContent({ quizId: 77, quizTitle: "Fixture Power Arena", subjectName: "QA", teacherId: "teacher", questions, studentId: "student", studentName: "Fixture Student", studentQuizId: "attempt", initialQuizStatus: "in_progress", initialStudentStatus: "in_progress", savedAnswers: [] });
  return renderToStaticMarkup(React.createElement("div", { className: "ps-assessment-theme ps-assessment-route " + (scene === "exam" ? "ps-exam-theme" : "ps-arena-theme") }, view));
}
