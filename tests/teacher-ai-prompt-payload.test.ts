import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };

const componentPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/quizzes/content.tsx");
const apiSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/ai/create/route.ts"), "utf8");
const compiled = ts.transpileModule(fs.readFileSync(componentPath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

function nodesOf(value: unknown, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ElementNode;
  return [...(predicate(node) ? [node] : []), ...nodesOf(node.props.children, predicate)];
}

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

function invoke(node: ElementNode, handler: "onClick" | "onChange", event?: unknown) {
  (node.props[handler] as (event?: unknown) => void)(event);
}

function fixture(options: { subscribed?: boolean; failure?: string } = {}) {
  const states: unknown[] = [];
  const effects: Array<() => void> = [];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const alerts: string[] = [];
  let stateIndex = 0;
  let collectEffects = true;
  const react = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(states[index]) : next;
      }];
    },
    useEffect: (callback: () => void) => { if (collectEffects) effects.push(callback); },
    useRef: () => ({ current: {} }),
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const component: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
      if (name === "react-dom") return { createPortal: (child: ElementNode) => child };
      if (name === "@/lib/subscription-rules") return { FREE_STUDENT_LIMIT_PER_QUIZ: 5, PRO_STUDENT_LIMIT_PER_QUIZ: 100 };
      if (name === "next/link") return "link";
      if (name === "@/components/teacher/proctorshield-quiz-editor") return { __esModule: true, default: "editor" };
      if (name === "@/components/teacher/proctorshield-create-hub") return { __esModule: true, default: "hub" };
      if (name === "lucide-react") return {};
      if (name === "@/lib/backup-write-gate" || name === "./backup-write-gate") return { withBackupWriteGate: (handler: unknown) => handler, runBackupWriteOrReject: (work: () => Promise<unknown>) => work(), runIncidentalBackupWrite: (work: () => Promise<unknown>) => work() };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch: async (url: string, request: { body: string }) => {
      requests.push({ url, body: JSON.parse(request.body) });
      return {
        ok: !options.failure,
        status: options.failure ? 400 : 200,
        json: async () => options.failure
          ? { error: options.failure }
          : { success: true, aiGenerationReceipt: "signed-receipt", questions: [{ questionText: "Generated", choices: [] }] },
      };
    },
    alert: (message: string) => alerts.push(message),
    FileReader: class {
      result = "data:image/png;base64,QUJD";
      onloadend?: () => void;
      readAsDataURL() { this.onloadend?.(); }
    },
    document: { body: {}, createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,QUJD" }) },
    window: { location: { search: "" } },
    console: { error() {} },
  }, { filename: componentPath });

  const render = () => { stateIndex = 0; collectEffects = false; return component.default!({ isSubscribed: options.subscribed ?? true }); };
  stateIndex = 0;
  component.default!({ isSubscribed: options.subscribed ?? true });
  effects[0]();
  const node = (predicate: (entry: ElementNode) => boolean) => nodesOf(render(), predicate)[0];
  const open = () => (node((entry) => entry.type === "hub").props.onOpenAiGenerator as () => void)();
  const tab = (label: string) => (node((entry) => entry.type === "button" && textOf(entry) === label).props.onClick as () => void)();
  const submit = async () => (node((entry) => entry.type === "form" && typeof entry.props.onSubmit === "function").props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault() {} });
  return { render, node, open, tab, submit, requests, alerts };
}

test("AI create API accepts topic and numQuestions with its existing 1–50 limit", () => {
  assert.match(apiSource, /const \{ imageBase64, mimeType, topic, numQuestions \} = body/);
  assert.match(apiSource, /requestedQuestions < 1 \|\| requestedQuestions > 50/);
});

test("Prompt/Text sends trimmed topic and selected numQuestions, not legacy field names", async () => {
  const setup = fixture();
  setup.open();
  invoke(setup.node((entry) => entry.type === "textarea"), "onChange", { target: { value: "  Data structures  " } });
  const countInput = setup.node((entry) => entry.props.id === "ai-question-count");
  assert.equal(countInput.props.min, 1);
  assert.equal(countInput.props.max, 50);
  invoke(countInput, "onChange", { target: { value: "7" } });
  await setup.submit();
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].url, "/api/ai/create");
  assert.deepEqual({ ...setup.requests[0].body }, { type: "text", topic: "Data structures", numQuestions: 7 });
  assert.equal("textPrompt" in setup.requests[0].body, false);
  assert.equal("questionCount" in setup.requests[0].body, false);
  const editor = setup.node((entry) => entry.type === "editor");
  assert.equal((editor.props.initialQuiz as Record<string, unknown>).aiGenerationReceipt, "signed-receipt");
});

test("Prompt/Text defaults to five questions and rejects counts outside the API limit", async () => {
  const setup = fixture();
  setup.open();
  invoke(setup.node((entry) => entry.type === "textarea"), "onChange", { target: { value: "Biology" } });
  invoke(setup.node((entry) => entry.props.id === "ai-question-count"), "onChange", { target: { value: "51" } });
  await setup.submit();
  assert.equal(setup.requests.length, 0);
  assert.match(setup.alerts[0], /between 1 and 50/);
  invoke(setup.node((entry) => entry.props.id === "ai-question-count"), "onChange", { target: { value: "5" } });
  await setup.submit();
  assert.equal(setup.requests[0].body.numQuestions, 5);
});

test("Upload and webcam retain their existing image request fields", async () => {
  const upload = fixture();
  upload.open();
  upload.tab("Upload File/Image");
  invoke(upload.node((entry) => entry.type === "input" && entry.props.type === "file"), "onChange", { target: { files: [{}] } });
  await upload.submit();
  assert.deepEqual({ ...upload.requests[0].body }, { type: "upload", questionCount: 5, imageBase64: "QUJD", mimeType: "image/png" });

  const webcam = fixture();
  webcam.open();
  webcam.tab("Webcam Scan");
  invoke(webcam.node((entry) => entry.type === "button" && textOf(entry) === " Capture Photo"), "onClick");
  await webcam.submit();
  assert.deepEqual({ ...webcam.requests[0].body }, { type: "webcam", questionCount: 5, imageBase64: "QUJD", mimeType: "image/jpeg" });
});

test("non-OK AI response shows its error without opening Studio", async () => {
  const setup = fixture({ failure: "Generation unavailable" });
  setup.open();
  invoke(setup.node((entry) => entry.type === "textarea"), "onChange", { target: { value: "Mathematics" } });
  await setup.submit();
  assert.deepEqual(setup.alerts, ["Generation unavailable"]);
  assert.ok(setup.node((entry) => entry.type === "form" && typeof entry.props.onSubmit === "function"));
  assert.equal(setup.node((entry) => entry.type === "editor"), undefined);
});

test("Free Teacher still cannot open the AI generator modal", () => {
  const setup = fixture({ subscribed: false });
  setup.open();
  assert.equal(setup.node((entry) => entry.type === "form" && typeof entry.props.onSubmit === "function"), undefined);
  assert.equal(setup.requests.length, 0);
});
