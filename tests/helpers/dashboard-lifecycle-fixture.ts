import * as quizScanner from "../../src/lib/quiz-scanner.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { authFixture } from "./auth-fixture.ts";

type Element = { type: unknown; props: Record<string, any> };
export type Reply = { status?: number; body?: unknown } | Error;
type Hook = { value?: any; deps?: unknown[]; cleanup?: () => void };
type Instance = { hooks: Hook[]; mounted: boolean };

export const notification = (title = "Private Admin notification") => ({
  success: true, unreadCount: 1,
  notifications: [{ id: "1", title, message: "Private retained data", isRead: false, createdAt: "2026-10-02T00:00:00Z", actionUrl: "/dashboard/admin" }],
});
export const dashboard = {
  stats: { totalUsers: 7, totalQuizzes: 1, totalViolations: 2, aiVerdictsToday: 3 },
  platformBars: [], activityBars: [], activities: [],
  users: [{ id: "teacher", name: "Privileged user row", email: "private@example.invalid", role: "Teacher", plan: "Free Tier", status: "Active" }],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as Element).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}

export function find(root: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, predicate)).find(Boolean);
  if (!root || typeof root !== "object" || !("props" in root)) return;
  const node = root as Element;
  return predicate(node) ? node : find(node.props.children, predicate);
}

// Mount the actual shell, its actual context provider, and the actual dashboard
// together. Only browser/network/React scheduling primitives are simulated;
// authorization propagation and all component callbacks execute production code.
export const teacherDashboard = {stats:{totalQuizzes:7,studentsMonitored:2,totalViolations:3,flaggedStudents:1},recentVerdicts:[{name:"Private Teacher result",quiz:"Private quiz",violations:[],verdict:"Clean",verdictClass:"",score:"100%"}],violationsBreakdown:[]};
export const studentQuizzes = {success:true,quizzes:[{id:"attempt",quizId:44,attemptNumber:1,quizStatus:"pending_retake",score:100,quiz:{id:44,title:"Private Student quiz",quizStatus:"ended",quizMode:"proctored",teacher:{fullName:"QA Teacher"}}}]};
export function fixture(role: "admin" | "teacher" | "student" = "admin", auth?: ReturnType<typeof authFixture>, options: {teacherSource?: string; retakeSource?: string; studentUserId?: string; quizGet?: (request: Request) => Promise<Response>; nameEnforcer?: boolean; nameEnforcerInitialName?: string} = {}) {
  const instances = new Map<unknown, Instance>();
  const modules = new Map<string, Record<string, any>>();
  const queues = new Map<string, Array<Reply | Promise<Reply>>>();
  const requests: Array<{ url: string; method: string; signal?: AbortSignal; settled: boolean }> = [];
  const errors: unknown[][] = [];
  const timers = new Map<number, { callback: () => void; period: number; due: number }>();
  const pendingEffects: Array<{owner: Instance; run: () => void}> = [];
  const rendered = new Set<Instance>();
  const pushes: string[] = [];
  const router = { push: (url: string) => pushes.push(url), refresh() { pushes.push("refresh"); } };
  let current: Instance, hookIndex = 0, now = 0, nextTimer = 0, writesAfterUnmount = 0, stateWrites = 0;
  let view: unknown;

  const hook = () => current.hooks[hookIndex++] ??= {};
  const react: any = {
    createContext: (value: unknown) => {
      const context: { value: unknown; Provider?: unknown } = { value };
      context.Provider = { context };
      return context;
    },
    useContext: (context: { value: unknown }) => context.value,
    useState: (initial: unknown) => {
      const owner = current, slot = hook();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? initial() : initial;
      return [slot.value, (value: unknown) => {
        stateWrites++;
        if (!owner.mounted) writesAfterUnmount++;
        slot.value = typeof value === "function" ? value(slot.value) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const slot = hook();
      return slot.value ??= { current: initial };
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const slot = hook();
      if (!slot.deps || deps.some((item, index) => !Object.is(item, slot.deps![index]))) {
        slot.deps = deps;
        slot.value = callback;
      }
      return slot.value;
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const slot = hook();
      if (!slot.deps || deps.some((item, index) => !Object.is(item, slot.deps![index]))) {
        slot.deps = deps;
        pendingEffects.push({owner: current, run: () => { slot.cleanup?.(); slot.cleanup = effect() || undefined; }});
      }
    },
  };
  react.useTransition = () => [false, (callback: () => void) => callback()];
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  class Pusher {
    static clients: Pusher[] = [];
    connected = true;
    channels = new Map<string, { handlers: Map<string, () => void>; unbind_all: () => void; unbind: (event: string) => void; bind: (event: string, callback: () => void) => void }>();
    unsubscribed: string[] = [];
    options: { authEndpoint: string };
    constructor(_key: string, options: { authEndpoint: string }) { this.options = options; Pusher.clients.push(this); }
    subscribe(name: string) {
      const handlers = new Map<string, () => void>();
      const channel = { handlers, bind: (event: string, callback: () => void) => { handlers.set(event, callback); }, unbind_all: () => handlers.clear(), unbind: (event: string) => {handlers.delete(event);} };
      this.channels.set(name, channel);
      return channel;
    }
    unsubscribe(name: string) { this.unsubscribed.push(name); this.channels.delete(name); }
    disconnect() { this.connected = false; }
  }

  function load(relative: string): Record<string, any> {
    if (modules.has(relative)) return modules.get(relative)!;
    const filename = path.resolve(relative);
    const exports: Record<string, any> = {};
    modules.set(relative, exports);
    const replacement = relative === "src/app/dashboard/teacher/content.tsx" ? options.teacherSource
      : relative === "src/app/dashboard/student/retake-redirect.tsx" ? options.retakeSource : undefined;
    const compiled = ts.transpileModule(replacement ?? fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports,
      require(name: string) {
        if (name === "@/lib/quiz-scanner") return quizScanner;
        if (name === "@/lib/notification-presentation") return load("src/lib/notification-presentation.ts");
        if (name === "@/lib/student-result-summary") return load("src/lib/student-result-summary.ts");
      if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
        if (name === "next/link") return { __esModule: true, default: "a" };
        if (name === "next/navigation") return { usePathname: () => `/dashboard/${role}`, useRouter: () => router };
        if (name === "clsx") return { clsx: (...values: unknown[]) => values.join(" ") };
        if (name === "pusher-js") return { __esModule: true, default: Pusher };
        if (name === "./user-session-lifecycle" || name === "@/components/user-session-lifecycle") return load("src/components/user-session-lifecycle.tsx");
        if (name === "@/lib/retake-redirect") return load("src/lib/retake-redirect.ts");
        if (name === "@/lib/quiz-join") return load("src/lib/quiz-join.ts");
        if (name === "./quiz-join" || name === "./quiz-join.ts") return load("src/lib/quiz-join.ts");
        if (name === "@/lib/student-name") return load("src/lib/student-name.ts");
        if (name === "@/lib/quiz-access-code") return load("src/lib/quiz-access-code.ts");
        if (name === "@/lib/student-gamify") return {playBloop(){},playSuccessFanfare(){},playErrorBuzz(){},isSoundEnabled:()=>true,toggleSoundEnabled:()=>false};
        if (name === "@/components/teacher/proctorshield-create-hub") return {__esModule:true,default:"create-hub"};
        if (name === "./admin-session-lifecycle" || name === "@/components/admin-session-lifecycle") return load("src/components/admin-session-lifecycle.tsx");
        throw new Error(`Unexpected dependency: ${name}`);
      },
      fetch: async (url: string, requestOptions?: { method?: string; signal?: AbortSignal }) => {
        const method = requestOptions?.method ?? "GET";
        const record = { url, method, signal: requestOptions?.signal, settled: false };
        requests.push(record);
        try {
          const queueUrl = url.split("?")[0];
          const queued = queues.get(method + queueUrl)?.shift();
          if (queued === undefined && options.quizGet && queueUrl === "/api/quizzes") {
            return await options.quizGet(new Request(`https://app.example.test${url}`));
          }
          if (queued === undefined && auth && ["/api/auth/session", "/api/notifications"].includes(queueUrl)) {
            return await auth.load(`src/app${queueUrl}/route.ts`)[method](new Request(`https://app.example.test${url}`));
          }
          if (queued === undefined && auth && queueUrl === "/api/dashboard/teacher") {
            const session = await auth.load("src/lib/auth.ts").getUserSession();
            if (session?.role !== "teacher") return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"Content-Type":"application/json"}});
          }
          const reply = queued === undefined
            ? { status: 200, body: url === "/api/dashboard/admin" ? dashboard : queueUrl === "/api/dashboard/teacher" ? teacherDashboard : queueUrl === "/api/quizzes" ? studentQuizzes : queueUrl === "/api/student/progression" ? {success:true,totalExp:42,level:1} : queueUrl === "/api/auth/session" ? { user: { userId: role + "-id", role } } : method === "PUT" ? { success: true } : notification() }
            : await queued;
          if (reply instanceof Error) throw reply;
          const status = reply.status ?? 200;
          // Deliberately ignore abort to verify stale-continuation guards too.
          return { status, ok: status >= 200 && status < 300, json: async () => reply.body };
        } finally { record.settled = true; }
      },
      AbortController, Error,
      process: { env: { NEXT_PUBLIC_PUSHER_KEY: "test", NEXT_PUBLIC_PUSHER_CLUSTER: "ap1" } },
      setInterval: (callback: () => void, period: number) => {
        const id = ++nextTimer; timers.set(id, { callback, period, due: now + period }); return id;
      },
      clearInterval: (id: number) => { timers.delete(id); },
      console: { error(...values: unknown[]) { errors.push(values); }, warn() {} },
      document: { addEventListener() {}, removeEventListener() {}, documentElement: { classList: { add() {}, remove() {} } } },
      localStorage: { getItem: () => "light", setItem() {} },
      window: { setInterval: (callback: () => void,period: number) => { const id=++nextTimer; timers.set(id,{callback,period,due:now+period});return id; }, clearInterval: (id: number)=>timers.delete(id), matchMedia: () => ({ matches: false }), location: { href: "", assign(url: string) { pushes.push(url); }, reload() {pushes.push("reload");} } },
    }, { filename });
    return exports;
  }

  const Shell = load("src/components/dashboard-shell.tsx").default;
  const Dashboard = load(`src/app/dashboard/${role}/content.tsx`).default;
  const Retake = role === "student" ? load("src/app/dashboard/student/retake-redirect.tsx").default : null;
  const NameEnforcer = options.nameEnforcer ? load("src/components/name-enforcer.tsx").default : null;
  function materialize(value: any): any {
    if (Array.isArray(value)) return value.map(materialize);
    if (!value || typeof value !== "object" || !("props" in value)) return value;
    if (typeof value.type === "function") {
      const previous = current, previousIndex = hookIndex;
      current = instances.get(value.type) ?? { hooks: [], mounted: true };
      instances.set(value.type, current);
      rendered.add(current);
      hookIndex = 0;
      const result = value.type(value.props);
      current = previous; hookIndex = previousIndex;
      return materialize(result);
    }
    if (value.type?.context) {
      const context = value.type.context, previous = context.value;
      context.value = value.props.value;
      const result = materialize(value.props.children);
      context.value = previous;
      return result;
    }
    return { ...value, props: { ...value.props, children: materialize(value.props.children) } };
  }

  const ready = async () => { for (let i = 0; i < 3; i++) await new Promise(setImmediate); };
  const render = () => {
    rendered.clear();
    view = materialize(jsx(Shell, { role, userName: "QA User", userInitials: "QA", children: [jsx(Dashboard, {teacherId: auth ? "teacher" : "teacher-id", teacherName:"QA Teacher",isSubscribed:true}), ...(Retake ? [jsx(Retake,{userId:options.studentUserId ?? (auth ? "student" : "student-id")})] : []), ...(NameEnforcer ? [jsx(NameEnforcer,{initialName:options.nameEnforcerInitialName ?? "Student"})] : [])] }));
    // React passive mount effects run children first.
    for (const [type,instance] of instances) { if (!rendered.has(instance) && instance.mounted) { for (const slot of instance.hooks) slot.cleanup?.(); instance.mounted=false; instances.delete(type); } }
    const effects=pendingEffects.splice(0);
    for (const owner of [...new Set(effects.map(e=>e.owner))].reverse()) for (const effect of effects.filter(e=>e.owner===owner)) if(owner.mounted) effect.run();
    return view;
  };
  const advance = async (milliseconds: number) => {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.values()].filter((timer) => timer.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      now = due.due; due.due += due.period; due.callback(); await ready(); render();
    }
    now = target;
  };
  const unmount = () => {
    for (const instance of instances.values()) {
      for (const slot of instance.hooks) slot.cleanup?.();
      instance.mounted = false;
    }
  };
  const assertDisposed = () => {
    assert.equal(timers.size, 0, "no polling handles survive");
    assert.equal(Pusher.clients.filter((client) => client.connected).length, 0, "no realtime connections survive");
    assert.equal(requests.filter((request) => !request.settled && !request.signal?.aborted).length, 0, "no live fetch handles survive");
    assert.equal(writesAfterUnmount, 0, "disposed callbacks do not write React state");
  };
  return {
    render, ready, advance, unmount, assertDisposed, requests, pushes, errors,
    stateWriteCount: () => stateWrites,
    event: (channel: string,event: string) => Pusher.clients.find(c=>c.channels.has(channel))!.channels.get(channel)!.handlers.get(event)! as (data?: any)=>void,
    retry: () => find(render(),n=>n.type === "button" && textOf(n)==="Retry")!.props.onClick(),
    queue: (url: string, reply: Reply | Promise<Reply>, method = "GET") => { const key = method + url; const list = queues.get(key) ?? []; list.push(reply); queues.set(key, list); },
    notificationCount: () => (instances.get(Shell)!.hooks.find((slot) => Array.isArray(slot.value))!.value as unknown[]).length,
    notificationTitles: () => (instances.get(Shell)!.hooks.find((slot) => Array.isArray(slot.value))!.value as Array<{ title: string }>).map((item) => item.title).join(","),
    bell: () => find(render(), (node) => node.props["aria-label"] === "Open notifications")!,
    resources: () => ({ timers: timers.size, connected: Pusher.clients.filter((client) => client.connected).length, subscriptions: Pusher.clients.reduce((total, client) => total + client.channels.size, 0) }),
    channelNames: () => Pusher.clients.flatMap(client => [...client.channels.keys()]),
    authEndpoints: () => Pusher.clients.map(client => client.options.authEndpoint),
    shellCallback: (event = "activity") => { const name = "private-user-" + role + (auth ? "" : "-id"); return Pusher.clients.find((client) => client.channels.has(name))!.channels.get(event === "activity" ? "private-admin-dashboard" : name)!.handlers.get(event)!; },
    shellPoll: () => [...timers.values()].find((timer) => timer.period === 15_000)!.callback,
    remount: () => { unmount(); instances.clear(); render(); },
  };
}
