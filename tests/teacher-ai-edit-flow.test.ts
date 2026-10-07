import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as scanner from "../src/lib/quiz-scanner.ts";

type Node = { type: string; props: Record<string, any> };
const paths = {
  page: "src/app/dashboard/teacher/quizzes/content.tsx",
  editor: "src/components/teacher/proctorshield-quiz-editor.tsx",
};
const compiled = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, ts.transpileModule(fs.readFileSync(path.resolve(relative), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText]));
const oldQuestions = [{ questionText: "Old saved question", questionType: "multiple_choice", points: 1, choices: [
  { choiceText: "Old correct", isCorrect: true }, { choiceText: "Old distractor", isCorrect: false },
] }];
const generatedQuestions = ["New photosynthesis question", "New chlorophyll question"].map(questionText => ({ questionText, questionType: "multiple_choice", points: 1, choices: [
  { choiceText: "New correct", isCorrect: true }, { choiceText: "New distractor", isCorrect: false },
] }));
function nodes(value: any, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate));
  if (!value?.props) return [];
  return [...(predicate(value) ? [value] : []), ...nodes(value.props.children, predicate)];
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value?.props) return text(value.props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
function hookRunner() {
  const slots: any[] = [];
  let index = 0;
  let changed = false;
  let effects: Array<() => void> = [];
  const hooks = {
    useState(initial: any) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
      return [slots[key], (next: any) => {
        const value = typeof next === "function" ? next(slots[key]) : next;
        if (!Object.is(value, slots[key])) { slots[key] = value; changed = true; }
      }];
    },
    useRef(initial: any) { const key = index++; return slots[key] ??= { current: initial }; },
    useEffect(callback: () => void, dependencies: any[]) {
      const key = index++;
      if (!(key in slots) || dependencies.some((dependency, i) => !Object.is(dependency, slots[key][i]))) {
        slots[key] = dependencies;
        effects.push(callback);
      }
    },
  };
  return { hooks, render(component: () => Node) {
    let result!: Node;
    for (let attempt = 0; attempt < 8; attempt++) {
      index = 0; changed = false; effects = [];
      result = component();
      effects.forEach(effect => effect());
      if (!changed) return result;
    }
    throw Error("Component did not settle");
  } };
}
async function fixture(options: { locked?: boolean; failure?: boolean; subscribed?: boolean } = {}) {
  const quiz = { id: 7, title: "Existing QA Quiz", subject: { subjectName: "Science" }, duration: 28, passingScore: 80,
    shuffleQuestions: false, allowRetake: true, isGamified: false, quizMode: "proctored", quizStatus: "draft",
    hasAttempts: options.locked ?? false, participantCount: options.locked ? 1 : 0, accessCode: "PS-QA", questions: oldQuestions };
  const requests: Array<{ url: string; method: string; body?: Record<string, any> }> = [];
  const alerts: string[] = [];
  const stored = [quiz];
  const subscribed = options.subscribed ?? true;
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    let data: any;
    let ok = true;
    if (url === "/api/billing/status") data = { isSubscribed: subscribed };
    else if (url === "/api/quizzes" && method === "GET") data = { quizzes: stored, pendingRetakes: [], pendingApprovals: [] };
    else if (url === "/api/quizzes/7" && method === "GET") data = { success: true, quiz: stored[0], questions: stored[0].questions };
    else if (url === "/api/ai/create") {
      ok = !options.failure;
      data = ok ? { success: true, aiGenerationReceipt: "signed-test-receipt", detectedTitle: "Generated Biology Quiz",
        detectedSubject: "Biology", detectedDescription: "New source", questions: generatedQuestions } : { error: "Provider unavailable" };
    } else if (url === "/api/quizzes/7" && method === "PUT") {
      Object.assign(stored[0], body); data = { success: true, quiz: stored[0] };
    } else if (url === "/api/quizzes" && method === "POST") {
      const created = { ...quiz, ...body, id: 8 }; stored.push(created); data = { success: true, quiz: created };
    } else throw Error(`Unexpected request: ${method} ${url}`);
    return { ok, status: ok ? 200 : 503, json: async () => data };
  };
  const load = (key: "page" | "editor") => {
    const runner = hookRunner();
    const exports: { default?: (props: any) => Node } = {};
    const jsx = (type: string, props: Record<string, any>) => {
      if (type === "video" && props.ref) props.ref.current = { readyState: 2, videoWidth: 1280, videoHeight: 720 };
      return { type, props };
    };
    vm.runInNewContext(compiled[key], {
      exports, require(name: string) {
        if (name === "react") return runner.hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "react-dom") return { createPortal: (child: Node) => child };
        if (name === "lucide-react") return {};
        if (name === "next/link") return "link";
        if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
        if (name === "@/lib/quiz-scanner") return { ...scanner, captureQuizScan: () => ({ name: "Public QA notes", dataUrl: "data:image/jpeg;base64,QUJD" }), startQuizScannerCamera: () => () => {} };
        if (name === "@/lib/subscription-rules") return { FREE_STUDENT_LIMIT_PER_QUIZ: 5, PRO_STUDENT_LIMIT_PER_QUIZ: 100 };
        if (name === "@/components/teacher/proctorshield-quiz-editor") return { __esModule: true, default: "editor" };
        if (name === "@/components/teacher/proctorshield-create-hub") return { __esModule: true, default: "hub" };
        throw Error(`Unexpected dependency: ${name}`);
      }, fetch, alert: (message: string) => alerts.push(message), console: { error() {} },
      document: { body: { style: {} } }, window: { location: { search: "" } }, URLSearchParams,
    }, { filename: paths[key] });
    return (props: any) => runner.render(() => exports.default!(props));
  };
  const page = load("page"), editor = load("editor");
  const renderPage = () => page({ isSubscribed: subscribed });
  const pageNode = (predicate: (node: Node) => boolean) => nodes(renderPage(), predicate)[0];
  const renderEditor = () => { const node = pageNode(node => node.type === "editor"); assert.ok(node); return editor(node.props); };
  const editorNode = (predicate: (node: Node) => boolean) => nodes(renderEditor(), predicate)[0];
  const button = (label: string) => editorNode(node => node.type === "button" && (text(node) === label || node.props.title === label));
  renderPage(); await new Promise(setImmediate);
  const openExisting = async () => {
    const row = pageNode(node => node.type === "tr" && text(node).includes("Existing QA Quiz"));
    assert.ok(row);
    await nodes(row, node => node.type === "button" && text(node) === "Edit")[0].props.onClick(); renderEditor();
  };
  const generate = async (source: "text" | "camera") => {
    if (source === "camera") {
      pageNode(node => node.type === "button" && text(node) === "Document Scanner").props.onClick();
      pageNode(node => node.type === "button" && text(node) === "Scan with Camera").props.onClick();
      pageNode(node => node.type === "button" && text(node) === "Capture Photo").props.onClick();
    } else pageNode(node => node.type === "textarea").props.onChange({ target: { value: "Public plant notes" } });
    pageNode(node => node.type === "input" && node.props.type === "number" && node.props.max === 50).props.onChange({ target: { value: "2" } });
    await pageNode(node => node.type === "form" && node.props.onSubmit).props.onSubmit({ preventDefault() {} });
    return renderEditor();
  };
  const setDuration = () => {
    button("Quiz Settings").props.onClick();
    editorNode(node => node.type === "input" && node.props.max === 480).props.onChange({ target: { value: "33" } });
    button("Save Settings").props.onClick();
  };
  return { requests, alerts, stored, renderPage, renderEditor, pageNode, editorNode, button, openExisting, generate, setDuration };
}
for (const source of ["text", "camera"] as const) {
  test(`Edit → AI ${source} replaces questions in the same quiz and preserves configured settings`, async () => {
    const setup = await fixture(); await setup.openExisting(); setup.setDuration();
    const entry = source === "text" ? setup.button("AI Generator") : setup.editorNode(node => node.type === "button" && text(node).startsWith("AI Generator Assistant"));
    entry.props.onClick();
    const generated = await setup.generate(source);
    assert.match(text(generated), /New photosynthesis question/);
    assert.doesNotMatch(text(generated), /Old saved question/);
    await setup.button("Publish Quiz").props.onClick();
    const save = setup.requests.find(request => request.method === "PUT" || request.method === "POST" && request.url === "/api/quizzes");
    assert.equal(save?.method, "PUT"); assert.equal(save?.url, "/api/quizzes/7");
    assert.equal(save?.body?.duration, 33); assert.equal(save?.body?.quizMode, "proctored");
    assert.equal(save?.body?.passingScore, 80); assert.equal(save?.body?.shuffleQuestions, false);
    assert.equal(save?.body?.allowRetake, true); assert.equal(setup.stored.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(setup.stored[0].questions)), generatedQuestions);
    await new Promise(setImmediate);
    const reopenedRow = setup.pageNode(node => node.type === "tr" && text(node).includes("Generated Biology Quiz"));
    await nodes(reopenedRow, node => node.type === "button" && text(node) === "Edit")[0].props.onClick();
    assert.match(text(setup.renderEditor()), /New chlorophyll question/);
  });
}
test("AI failure keeps the existing quiz identity, unsaved settings, and old questions", async () => {
  const setup = await fixture({ failure: true }); await setup.openExisting(); setup.setDuration();
  setup.button("AI Generator").props.onClick(); const failed = await setup.generate("text");
  assert.match(text(failed), /Old saved question/); assert.deepEqual(setup.alerts, ["Provider unavailable"]);
  await setup.button("Publish Quiz").props.onClick();
  const save = setup.requests.find(request => request.method === "PUT");
  assert.equal(save?.url, "/api/quizzes/7"); assert.equal(save?.body?.duration, 33);
});
test("AI replacement is unavailable once students have joined or attempted the quiz", async () => {
  const setup = await fixture({ locked: true }); await setup.openExisting();
  for (const entry of nodes(setup.renderEditor(), node => node.type === "button" && text(node).startsWith("AI Generator"))) {
    assert.equal(entry.props.disabled, true); entry.props.onClick();
  }
  assert.equal(setup.pageNode(node => node.type === "form" && node.props.onSubmit), undefined);
  assert.equal(setup.requests.some(request => request.url === "/api/ai/create"), false);
});
test("new manual quiz retains its mode and unsaved duration when enhanced with AI", async () => {
  const setup = await fixture(); setup.pageNode(node => node.type === "hub").props.onOpenCreateQuiz("proctored");
  setup.setDuration(); setup.button("AI Generator").props.onClick(); await setup.generate("text");
  await setup.button("Publish Quiz").props.onClick();
  const save = setup.requests.find(request => request.method === "POST" && request.url === "/api/quizzes");
  assert.equal(save?.body?.duration, 33); assert.equal(save?.body?.quizMode, "proctored");
  assert.equal(save?.body?.aiGenerationReceipt, "signed-test-receipt");
});
test("standalone AI Create still creates a new verified quiz", async () => {
  const setup = await fixture(); setup.pageNode(node => node.type === "hub").props.onOpenAiGenerator(); await setup.generate("text");
  await setup.button("Publish Quiz").props.onClick();
  const save = setup.requests.find(request => request.method === "POST" && request.url === "/api/quizzes");
  assert.equal(save?.body?.duration, 60); assert.equal(save?.body?.quizMode, "arena");
  assert.equal(save?.body?.aiGenerationReceipt, "signed-test-receipt"); assert.equal(setup.stored.length, 2);
});
