import { refactorTestSource } from "./helpers/refactor-source.ts";
import { defenseDependency } from "./helpers/defense-feature-fixture.ts";
import * as quizScanner from "../src/lib/quiz-scanner.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: string; props: Record<string, unknown> };

const componentPath = path.resolve(process.cwd(), "src/features/quizzes/components/teacher-quizzes.tsx");
const apiSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/ai/create/route.ts"), "utf8");
const compiled = ts.transpileModule(refactorTestSource(componentPath), {
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
  return (node.props[handler] as (event?: unknown) => void)(event);
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
    useRef: (initial: unknown) => ({ current: initial }),
  };
  const jsx = (type: string | ((props: Record<string, unknown>) => any), props: Record<string, unknown>) => {
    if (typeof type === "function") return type(props);
    if (type === "video" && props.ref) (props.ref as { current: unknown }).current = { readyState: 2, videoWidth: 1280, videoHeight: 720 };
    return { type, props };
  };
  const component: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  vm.runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      if (name === "server-only") return {};
      const featureDependency = defenseDependency(name); if (featureDependency !== undefined) return featureDependency;
      if (name === "@/lib/quiz-scanner") return { ...quizScanner, prepareQuizScan: async () => ({ name: "Fixture image", dataUrl: "data:image/jpeg;base64,QUJD" }), captureQuizScan: () => ({ name: "Camera scan", dataUrl: "data:image/jpeg;base64,QUJD" }) };
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
    document: { body: {}, createElement: () => ({ getContext: () => ({ drawImage() {}, fillRect() {} }), toDataURL: () => "data:image/jpeg;base64,QUJD" }) },
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

test("AI UI exposes Upload and Scan only, defaults to Upload and rejects an empty source", async () => {
  const setup = fixture(); setup.open();
  const tabs = nodesOf(setup.render(), node => node.props.role === "tab");
  assert.deepEqual(tabs.map(textOf), ["Upload", "Scan"]);
  assert.equal(tabs[0].props["aria-selected"], true);
  assert.equal(setup.node(node => node.type === "textarea"), undefined);
  await setup.submit(); assert.equal(setup.requests.length, 0); assert.match(setup.alerts[0], /upload a file first/);
});

test("Upload defaults to five questions and validates the shared 1–50 limit", async () => {
  const setup = fixture(); setup.open();
  await invoke(setup.node(node => node.type === "input" && node.props.type === "file"), "onChange", { target: { files: [{}] } });
  const count=setup.node(node => node.props.id === "scan-question-count"); assert.equal(count.props.value,5);
  invoke(count,"onChange",{target:{value:"51"}});await setup.submit();assert.equal(setup.requests.length,0);assert.match(setup.alerts[0],/between 1 and 50/);
  invoke(count,"onChange",{target:{value:"7"}});await setup.submit();assert.equal(setup.requests[0].body.numQuestions,7);
});

test("Upload and camera share the scanner payload and selected question count", async () => {
  const upload = fixture();
  upload.open();
  upload.tab("Upload");
  await invoke(upload.node((entry) => entry.type === "input" && entry.props.type === "file"), "onChange", { target: { files: [{}] } });
  await Promise.resolve();
  await upload.submit();
  assert.deepEqual({ ...upload.requests[0].body }, { type: "scanner", numQuestions: 5, imageBase64: "QUJD", mimeType: "image/jpeg" });

  const webcam = fixture();
  webcam.open();
  webcam.tab("Scan");
  invoke(webcam.node((entry) => entry.type === "button" && textOf(entry) === "Scan with Camera"), "onClick");
  invoke(webcam.node((entry) => entry.type === "button" && textOf(entry) === "Capture Photo"), "onClick");
  await webcam.submit();
  assert.deepEqual({ ...webcam.requests[0].body }, { type: "scanner", numQuestions: 5, imageBase64: "QUJD", mimeType: "image/jpeg" });
});

test("non-OK AI response shows its error without opening Studio", async () => {
  const setup = fixture({ failure: "Generation unavailable" });
  setup.open();
  await invoke(setup.node((entry) => entry.type === "input" && entry.props.type === "file"), "onChange", { target: { files: [{}] } });
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
