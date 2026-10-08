import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, any> };
const quiz = { id: 77, title: "Operating Systems Practice", description: "Classroom practice questions", accessCode: "PS-THEME77",
  duration: 15, passingScore: 70, quizType: "multiple_choice", quizMode: "arena", quizStatus: "draft",
  subjectName: "Computer Science", subjectCode: "CS101", questionsCount: 5, attemptsCount: 0,
  createdAt: "2026-10-07T08:00:00Z", _count: { questions: 5, studentQuizzes: 0 },
  questions: [{ id: 1, questionText: "What does an operating system manage?", points: 1,
    choices: [{ id: 1, choiceText: "Resources", isCorrect: true }, { id: 2, choiceText: "Weather", isCorrect: false }] }] };
const evidence = { id: "1", name: "Fixture Student", quizTitle: quiz.title, event: "Looking Away", violationType: "looking_away",
  timestamp: "2026-10-07T08:00:00Z", bg: "bg-rose-500/10", btnClass: "bg-indigo-600 text-white",
  screenshotPath: null, evidenceType: "image/jpeg", durationSeconds: null };
const base = "src/app/dashboard/teacher/";
export const teacherScenes = ["dashboard", "playground", "arena", "quizzes", "monitor", "evidence", "reports", "billing", "settings"] as const;
export type TeacherScene = typeof teacherScenes[number];

// Render the real component JSX with owned display data. Effects/network are
// omitted here; behavior is covered by the existing controller regressions.
// Portals are serialized separately, preserving their actual body placement.
export function teacherThemeFixture(scene: TeacherScene, variant = "default") {
  const portals: Element[] = [];
  const modules = new Map<string, Record<string, any>>();
  const state: Record<string, any> = { isLoading: false, loading: false, hasLoadedDashboard: true, hasLoadedBilling: true,
    isCheckingSub: false, mounted: true, portalMounted: true, isSubscribed: true,
    user: { fullName: "Fixture Teacher", email: "teacher@example.test" }, fullName: "Fixture Teacher",
    stats: { totalQuizzes: 7, studentsMonitored: 24, totalViolations: 3, flaggedStudents: 1 },
    recentVerdicts: [{ name: "Fixture Student", quiz: quiz.title, violations: ["Looking Away"], verdict: "Review", verdictClass: "bg-amber-500/15 text-amber-600", score: "80%" }],
    quizzes: [quiz], evidenceList: [evidence], total: 1,
    feeds: [{ id: "student", name: "Fixture Student", quizTitle: quiz.title, status: "Connected", statusColor: "text-emerald-500",
      border: "border-emerald-500/30", joinedAt: new Date(), lastSeen: new Date(), violationCount: 1, snapshot: null, connectionStatus: "online" }],
    monitorCounters: { activeStudents: 1, totalViolations: 1 },
    data: { isSubscribed: true, reports: [], totalReports: 0, totalViolations: 0, page: 1, pageSize: 12, totalPages: 1, types: [], filters: { search: "", type: "" } },
  };
  if (variant === "dialog") {
    if (scene === "playground") state.isModalOpen = true;
    if (scene === "quizzes") { state.isEditorOpen = true; state.editingQuizData = quiz; }
    if (scene === "evidence") { state.isFullscreen = true; state.selectedEvidence = evidence; }
  }
  if (variant === "free") state.isSubscribed = false;
  if (scene === "quizzes" && variant === "answers") {
    state.isEditorOpen = true; state.editingQuizData = quiz; state.studioMode = "question_studio";
    state.draftQuestion = { questionText: "Name an operating system", questionType: "fill_in_blank",
      points: 1, timeLimitSeconds: 30, choices: [{ choiceText: "Linux", isCorrect: true }] };
  }
  if (scene === "quizzes" && variant === "locked") {
    state.isEditorOpen = true; state.editingQuizData = { ...quiz, hasAttempts: true, participantCount: 1 };
    state.isSettingsOpen = true;
  }
  if (scene === "arena" && (variant === "wave" || variant === "podium")) {
    state.phase = variant;
    state.battlers = ["First", "Second", "Third"].map((name, index) => ({ id: String(index), name,
      initials: name[0], score: 300 - index * 100, rank: index + 1, questionsAnswered: 5,
      totalQuestions: 5, isFinished: true, hasShield: false, isAi: false }));
  }
  if (variant === "error") {
    if (scene === "playground") { state.isModalOpen = true; state.launchError = "Could not launch this Arena. Please retry."; }
    if (scene === "arena") state.arenaError = "Could not update the Arena. Please retry.";
    if (scene === "settings") state.toast = { type: "error", msg: "Could not save the profile. Please check your connection and retry. Your existing profile and password have not been changed." };
  }
  const jsx = (type: any, props: any) => typeof type === "function" ? type(props) : ({ type, props });
  const react = { Fragment: Symbol("fragment"), memo: (component: any) => component,
    useState: (initial: any, name: string) => {
      const value = Object.hasOwn(state, name) ? state[name] : typeof initial === "function" ? initial() : initial;
      return [value, (next: any) => { state[name] = typeof next === "function" ? next(value) : next; }];
    }, useEffect() {}, useRef: (value: any) => ({ current: value }), useCallback: (fn: any) => fn,
    useMemo: (fn: () => unknown) => fn(), createContext: (value: any) => ({ value }), useContext: (context: any) => context.value,
  };
  const labelStates: ts.TransformerFactory<ts.SourceFile> = context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node) && node.expression.getText(root) === "useState" && ts.isVariableDeclaration(node.parent)
        && ts.isArrayBindingPattern(node.parent.name)) {
        const binding = node.parent.name.elements[0];
        if (ts.isBindingElement(binding)) return context.factory.updateCallExpression(node, node.expression, node.typeArguments,
          [...node.arguments, context.factory.createStringLiteral(binding.name.getText(root))]);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  };
  const work = { capture: () => 0, isCurrent: () => true, addCleanup: () => () => {}, beginRequest: () => null };
  const load = (file: string): Record<string, any> => {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file)!;
    const exports = {}; modules.set(file, exports);
    const source = fs.readFileSync(file, "utf8");
    const output = ts.transpileModule(source, { fileName: file, transformers: { before: [labelStates] },
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, { exports, console, process: { env: {} }, URL, URLSearchParams, AbortController,
      window: { location: { search: "", origin: "https://example.test" } }, document: { body: {} },
      require(name: string) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "react-dom") return { createPortal: (node: Element) => { portals.push(node); return null; } };
        if (name === "next/link") return { __esModule: true, default: (props: any) => jsx("a", props) };
        if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
        if (name === "lucide-react") return new Proxy({}, { get: (_object, name) => (props: any) => jsx("svg", {
          ...props, "data-icon": String(name), fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: jsx("path", { d: "M4 12h16M12 4v16" }) }) });
        if (name === "pusher-js") return { __esModule: true, default: class {} };
        if (name === "@/components/user-session-lifecycle") return { useUserSessionWork: () => ({ work, loss: null }), UserSessionReauthentication: () => null };
        if (name === "@/lib/arena") return { computeArenaRankings: () => [] };
        if (name === "@/lib/subscription-rules") return { FREE_STUDENT_LIMIT_PER_QUIZ: 5, PRO_STUDENT_LIMIT_PER_QUIZ: 50, PRO_MONTHLY_PRICE_PHP: 299 };
        if (name === "@/lib/quiz-scanner") return {};
        if (name.startsWith("@/")) {
          const target = "src/" + name.slice(2);
          return load(fs.existsSync(target + ".tsx") ? target + ".tsx" : target + ".ts");
        }
        if (name.startsWith("./")) {
          const target = path.resolve(path.dirname(file), name);
          return load(fs.existsSync(target) ? target : target + ".tsx");
        }
        throw new Error("Unexpected display fixture dependency: " + name);
      },
    }, { filename: file });
    return exports;
  };
  const files: Record<TeacherScene, string> = { dashboard: base + "content.tsx", playground: base + "playground/content.tsx",
    arena: base + "playground/arena/[id]/content.tsx", quizzes: base + "quizzes/content.tsx", monitor: base + "monitor/content.tsx",
    evidence: base + "evidence/content.tsx", reports: base + "reports/content.tsx", billing: base + "billing/content.tsx", settings: base + "settings/content.tsx" };
  const view = load(files[scene]).default({ teacherId: "teacher", teacherName: "Fixture Teacher", isSubscribed: variant !== "free",
    initialIsSubscribed: variant !== "free", initialManualQuizCount: 1, initialManualQuizLimit: 5, planName: "Pro", quizzes: [quiz],
    quiz, enabledPowers: ["meteor", "earthquake", "blizzard", "shield"] });
  const escape = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  function html(node: any): string {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(html).join("");
    if (typeof node !== "object") return escape(node);
    if (typeof node.type !== "string") return html(node.props?.children);
    const attributes = Object.entries(node.props ?? {}).filter(([key, value]) => !["children", "key", "ref"].includes(key)
      && !key.startsWith("on") && typeof value !== "function" && value != null && value !== false)
      .map(([key, value]) => {
        if (key === "style") value = Object.entries(value as object).map(([property, setting]) => property.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()) + ":" + setting).join(";");
        return `${key === "className" ? "class" : key}="${escape(value)}"`;
      }).join(" ");
    return `<${node.type} ${attributes}>${html(node.props.children)}${["input", "img", "br"].includes(node.type) ? "" : `</${node.type}>`}`;
  }
  return { content: `<div class="teacher-content">${html(view)}</div>`, portals: portals.map(html).join("") };
}
