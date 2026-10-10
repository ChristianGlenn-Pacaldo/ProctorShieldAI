import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as scoreSummary from "../../src/lib/student-result-summary.ts";

export type StudentScene = "dashboard" | "settings" | "results";

const endedAt = "2026-10-08T10:00:00Z";
const exam = (id: string, score: number, extra: Record<string, unknown> = {}) => ({
  id, score, attemptMode: "proctored", quizStatus: "completed", endTime: endedAt, createdAt: endedAt,
  aiVerdict: "clean", cheatingProbability: 0, _count: { violations: 0 },
  quiz: { id: 42, title: id, quizStatus: "ended", quizMode: "proctored", duration: 30, subject: { subjectName: "QA Subject" } },
  ...extra,
});
const attempts = [
  exam("QA Exam", 80), exam("QA Arena", 213, { attemptMode: "arena", aiVerdict: null }),
  exam("QA Retake", 60, { quizStatus: "pending_retake" }),
  exam("QA Invalidated", 100, { _count: { violations: 3 } }),
];

// Actual component JSX and CSS with owned display data. This fixture does not
// authenticate against a server, run effects or perform network/database work.
export function studentThemeFixture(scene: StudentScene, variant = "default") {
  const state: Record<string, any> = {
    studentQuizzes: attempts, hasLoadedQuizzes: true, isFetching: false, quizLoadError: "",
    quickCode: "", joinLoading: false, joinError: "", soundActive: true,
    user: { fullName: "Disposable QA Student", email: "qa@example.invalid" }, fullName: "Disposable QA Student",
    results: attempts.map(row => ({ ...row, ...scoreSummary.studentResultState(row),
      score: scoreSummary.studentResultState(row).integrityInvalidated ? null : row.score,
      effectiveMode: row.attemptMode === "arena" ? "arena" : "proctored" })),
    hasLoaded: true, loading: false,
  };
  if (variant === "empty") { state.studentQuizzes = []; state.results = []; }
  if (scene === "results" && (variant === "loading" || variant === "load-error")) {
    state.results = []; state.hasLoaded = false; state.loading = variant === "loading";
    state.loadError = variant === "load-error" ? "Could not load your results." : "";
  }
  if (variant === "loading") { state.hasLoadedQuizzes = false; state.isFetching = true; }
  if (variant === "join-error") state.joinError = "Could not join this quiz. Please check your access code and try again.";
  if (variant === "error" || variant === "success") state.toast = { type: variant,
    msg: variant === "error" ? "Could not save your profile. Please check your connection and try again. Your existing name and password have not changed."
      : "Profile updated successfully!" };
  const jsx = (type: any, props: any): any => typeof type === "function" ? type(props) : ({ type, props });
  const react = {
    useState(initial: any, name: string) { const value = Object.hasOwn(state, name) ? state[name] : initial; return [value, () => {}]; },
    useEffect() {}, useRef: (initial: any) => ({ current: initial }), useCallback: (callback: any) => callback,
    useTransition: () => [false, (callback: () => void) => callback()],
  };
  const labelState: ts.TransformerFactory<ts.SourceFile> = context => source => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "useState" && ts.isVariableDeclaration(node.parent)
        && ts.isArrayBindingPattern(node.parent.name)) {
        const binding = node.parent.name.elements[0];
        if (ts.isBindingElement(binding)) return context.factory.updateCallExpression(node, node.expression, node.typeArguments,
          [...node.arguments, context.factory.createStringLiteral(binding.name.getText(source))]);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(source, visit) as ts.SourceFile;
  };
  const file = `src/app/dashboard/student/${scene === "dashboard" ? "" : scene + "/"}content.tsx`;
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: path.resolve(file),
    transformers: { before: [labelState] }, compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    exports, console,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/link") return { __esModule: true, default: (props: any) => jsx("a", props) };
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "@/lib/student-result-summary") return scoreSummary;
      if (name === "@/components/student/ResultModal") return { __esModule: true, default: () => null };
      if (name === "@/lib/student-gamify") return { isSoundEnabled: () => true };
      if (name === "@/lib/quiz-access-code") return { QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH: 20 };
      if (name === "@/components/user-session-lifecycle") return { useUserSessionWork: () => ({ work: {}, loss: null }) };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, name) => (props: any) => jsx("svg", {
        ...props, "data-icon": String(name), fill: "none", stroke: "currentColor", viewBox: "0 0 24 24",
        children: jsx("path", { d: "M4 12h16M12 4v16" }) }) });
      throw new Error(`Unexpected Student display dependency: ${name}`);
    },
  });
  const escape = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  function html(node: any): string {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(html).join("");
    if (typeof node !== "object") return escape(node);
    if (typeof node.type !== "string") return html(node.props?.children);
    const attrs = Object.entries(node.props ?? {}).filter(([key, value]) => !["children", "key", "ref"].includes(key)
      && !key.startsWith("on") && value != null && value !== false && typeof value !== "function")
      .map(([key, value]) => `${key === "className" ? "class" : key === "htmlFor" ? "for" : key}="${escape(value)}"`).join(" ");
    return `<${node.type} ${attrs}>${html(node.props.children)}${["input", "img", "br"].includes(node.type) ? "" : `</${node.type}>`}`;
  }
  return html(exports.default());
}
