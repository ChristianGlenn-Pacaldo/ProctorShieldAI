import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { authFixture } from "./helpers/auth-fixture.ts";

type Element = { type: unknown; props: Record<string, any> };
type Reply = { status?: number; body?: unknown } | Error;
type Hook = { value?: any; deps?: unknown[]; cleanup?: () => void };
type Instance = { hooks: Hook[]; mounted: boolean };

const notification = (title = "Private Admin notification") => ({
  success: true, unreadCount: 1,
  notifications: [{ id: "1", title, message: "Private retained data", isRead: false, createdAt: "2026-10-02T00:00:00Z", actionUrl: "/dashboard/admin" }],
});
const dashboard = {
  stats: { totalUsers: 7, totalQuizzes: 1, totalViolations: 2, aiVerdictsToday: 3 },
  platformBars: [], activityBars: [], activities: [],
  users: [{ id: "teacher", name: "Privileged user row", email: "private@example.invalid", role: "Teacher", plan: "Free Tier", status: "Active" }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as Element).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}

function find(root: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, predicate)).find(Boolean);
  if (!root || typeof root !== "object" || !("props" in root)) return;
  const node = root as Element;
  return predicate(node) ? node : find(node.props.children, predicate);
}

// Mount the actual shell, its actual context provider, and the actual dashboard
// together. Only browser/network/React scheduling primitives are simulated;
// authorization propagation and all component callbacks execute production code.
function fixture(role: "admin" | "teacher" | "student" = "admin", auth?: ReturnType<typeof authFixture>) {
  const instances = new Map<unknown, Instance>();
  const modules = new Map<string, Record<string, any>>();
  const queues = new Map<string, Array<Reply | Promise<Reply>>>();
  const requests: Array<{ url: string; method: string; signal?: AbortSignal; settled: boolean }> = [];
  const timers = new Map<number, { callback: () => void; period: number; due: number }>();
  const pendingEffects: Array<() => void> = [];
  let current: Instance, hookIndex = 0, now = 0, nextTimer = 0, writesAfterUnmount = 0;
  let view: unknown;

  const hook = () => current.hooks[hookIndex++] ??= {};
  const react = {
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
        if (!owner.mounted) writesAfterUnmount++;
        slot.value = typeof value === "function" ? value(slot.value) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const slot = hook();
      return slot.value ??= { current: initial };
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const slot = hook();
      if (!slot.deps || deps.some((item, index) => !Object.is(item, slot.deps![index]))) {
        slot.deps = deps;
        pendingEffects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  class Pusher {
    static clients: Pusher[] = [];
    connected = true;
    channels = new Map<string, { handlers: Map<string, () => void>; unbind_all: () => void; bind: (event: string, callback: () => void) => void }>();
    unsubscribed: string[] = [];
    options: { authEndpoint: string };
    constructor(_key: string, options: { authEndpoint: string }) { this.options = options; Pusher.clients.push(this); }
    subscribe(name: string) {
      const handlers = new Map<string, () => void>();
      const channel = { handlers, bind: (event: string, callback: () => void) => { handlers.set(event, callback); }, unbind_all: () => handlers.clear() };
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
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports,
      require(name: string) {
        if (name === "@/lib/notification-presentation") return load("src/lib/notification-presentation.ts");
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
        if (name === "next/link") return { __esModule: true, default: "a" };
        if (name === "next/navigation") return { usePathname: () => `/dashboard/${role}`, useRouter: () => ({ push() {} }) };
        if (name === "clsx") return { clsx: (...values: unknown[]) => values.join(" ") };
        if (name === "pusher-js") return { __esModule: true, default: Pusher };
        if (name === "./user-session-lifecycle") return load("src/components/user-session-lifecycle.tsx");
        if (name === "./admin-session-lifecycle" || name === "@/components/admin-session-lifecycle") return load("src/components/admin-session-lifecycle.tsx");
        throw new Error(`Unexpected dependency: ${name}`);
      },
      fetch: async (url: string, options?: { method?: string; signal?: AbortSignal }) => {
        const method = options?.method ?? "GET";
        const record = { url, method, signal: options?.signal, settled: false };
        requests.push(record);
        try {
          const queueUrl = url.split("?")[0];
          const queued = queues.get(method + queueUrl)?.shift();
          if (queued === undefined && auth && ["/api/auth/session", "/api/notifications"].includes(queueUrl)) {
            return await auth.load(`src/app${queueUrl}/route.ts`)[method](new Request(`https://app.example.test${url}`));
          }
          const reply = queued === undefined
            ? { status: 200, body: url === "/api/dashboard/admin" ? dashboard : queueUrl === "/api/auth/session" ? { user: { userId: role + "-id", role } } : method === "PUT" ? { success: true } : notification() }
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
      console: { error() {}, warn() {} },
      document: { addEventListener() {}, removeEventListener() {}, documentElement: { classList: { add() {}, remove() {} } } },
      localStorage: { getItem: () => "light", setItem() {} },
      window: { matchMedia: () => ({ matches: false }), location: { href: "" } },
    }, { filename });
    return exports;
  }

  const Shell = load("src/components/dashboard-shell.tsx").default;
  const Dashboard = load("src/app/dashboard/admin/content.tsx").default;
  function materialize(value: any): any {
    if (Array.isArray(value)) return value.map(materialize);
    if (!value || typeof value !== "object" || !("props" in value)) return value;
    if (typeof value.type === "function") {
      const previous = current, previousIndex = hookIndex;
      current = instances.get(value.type) ?? { hooks: [], mounted: true };
      instances.set(value.type, current);
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
    view = materialize(jsx(Shell, { role, userName: "QA User", userInitials: "QA", children: role === "admin" ? jsx(Dashboard, {}) : "Non-Admin content" }));
    // React passive mount effects run children first.
    for (const run of pendingEffects.splice(0).reverse()) run();
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
    render, ready, advance, unmount, assertDisposed, requests,
    queue: (url: string, reply: Reply | Promise<Reply>, method = "GET") => { const key = method + url; const list = queues.get(key) ?? []; list.push(reply); queues.set(key, list); },
    notificationCount: () => (instances.get(Shell)!.hooks.find((slot) => Array.isArray(slot.value))!.value as unknown[]).length,
    notificationTitles: () => (instances.get(Shell)!.hooks.find((slot) => Array.isArray(slot.value))!.value as Array<{ title: string }>).map((item) => item.title).join(","),
    bell: () => find(render(), (node) => node.props["aria-label"] === "Open notifications")!,
    resources: () => ({ timers: timers.size, connected: Pusher.clients.filter((client) => client.connected).length, subscriptions: Pusher.clients.reduce((total, client) => total + client.channels.size, 0) }),
    channelNames: () => Pusher.clients.flatMap(client => [...client.channels.keys()]),
    authEndpoints: () => Pusher.clients.map(client => client.options.authEndpoint),
    shellCallback: (event = "activity") => Pusher.clients.find((client) => client.channels.has("private-user-" + role + "-id"))!.channels.get(event === "activity" ? "private-admin-dashboard" : "private-user-" + role + "-id")!.handlers.get(event)!,
    shellPoll: () => [...timers.values()].find((timer) => timer.period === 15_000)!.callback,
    remount: () => { unmount(); instances.clear(); render(); },
  };
}

function assertLost(setup: ReturnType<typeof fixture>, status: 401 | 403) {
  const text = textOf(setup.render());
  assert.match(text, status === 401 ? /Admin session has expired or changed/ : /no longer have Admin access/);
  assert.doesNotMatch(text, /Privileged user row|Private Admin notification|Active Sessions|LIVE/);
  assert.equal(setup.notificationCount(), 0);
  assert.equal(setup.bell().props.disabled, true);
  assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
}

for (const status of [401, 403] as const) {
  test(`integrated Admin ${status} clears page/shell and stops every poll/subscription`, async () => {
    const setup = fixture(); setup.render(); await setup.ready();
    assert.match(textOf(setup.render()), /Privileged user row|LIVE/);
    assert.equal(setup.notificationCount(), 1);
    assert.deepEqual(setup.resources(), { timers: 2, connected: 2, subscriptions: 3 });
    const queuedCallback = setup.shellCallback(), queuedPoll = setup.shellPoll();
    setup.queue("/api/dashboard/admin", { status });
    await setup.advance(30_000);
    assertLost(setup, status);
    const requestsAtLoss = setup.requests.length;
    queuedCallback(); queuedPoll(); await setup.bell().props.onClick();
    await setup.advance(35_000);
    assert.equal(setup.requests.length, requestsAtLoss, "no poll, queued event, or bell request after loss");
    assertLost(setup, status);
    setup.unmount(); setup.assertDisposed();
  });
}

test("initial Admin 401 never displays retained data or leaves background work running", async () => {
  const setup = fixture(); setup.queue("/api/dashboard/admin", { status: 401 });
  setup.render(); await setup.ready(); assertLost(setup, 401);
  const count = setup.requests.length; await setup.advance(35_000);
  assert.equal(setup.requests.length, count);
  setup.unmount(); setup.assertDisposed();
});

for (const parsing of [false, true]) {
  test(`old shell notification ${parsing ? "JSON parsing" : "HTTP response"} cannot restore notifications after newer Admin 401`, async () => {
    const setup = fixture(); setup.render(); await setup.ready();
    const pending = deferred<any>();
    setup.queue("/api/notifications", parsing ? { body: pending.promise } : pending.promise);
    const event = setup.shellCallback(); event(); await setup.ready();
    const inFlight = setup.requests.at(-1)!;
    setup.queue("/api/dashboard/admin", { status: 401 });
    await setup.advance(30_000); assertLost(setup, 401);
    assert.equal(inFlight.signal?.aborted, true);
    pending.resolve(parsing ? notification("Old notification") : { body: notification("Old notification") });
    await setup.ready(); assertLost(setup, 401);
    setup.unmount(); setup.assertDisposed();
  });
}

test("queued Admin realtime callback and timer cannot start work after shell-detected 401", async () => {
  const setup = fixture(); setup.render(); await setup.ready();
  const callback = setup.shellCallback(), poll = setup.shellPoll();
  setup.queue("/api/notifications", { status: 401 }); callback(); await setup.ready();
  assertLost(setup, 401);
  const count = setup.requests.length; callback(); poll(); await setup.ready();
  assert.equal(setup.requests.length, count);
  setup.unmount(); setup.assertDisposed();
});

test("shell session role mismatch propagates 403 and late session lookup cannot subscribe after loss", async () => {
  const setup = fixture();
  setup.queue("/api/auth/session", { body: { user: { userId: "teacher-id", role: "teacher" } } });
  setup.render(); await setup.ready(); assertLost(setup, 403);
  setup.unmount(); setup.assertDisposed();
  const delayed = fixture(), pending = deferred<Reply>();
  delayed.queue("/api/auth/session", pending.promise); delayed.render(); await delayed.ready();
  delayed.queue("/api/dashboard/admin", { status: 401 }); await delayed.advance(30_000);
  pending.resolve({ body: { user: { userId: "admin-id", role: "admin" } } });
  await delayed.ready(); assertLost(delayed, 401);
  delayed.unmount(); delayed.assertDisposed();
});

for (const failure of [{ status: 500 }, new Error("network failure")]) {
  test(`transient ${failure instanceof Error ? "network" : "500"} failure preserves shell polling and retry`, async () => {
    const setup = fixture(); setup.render(); await setup.ready();
    setup.queue("/api/dashboard/admin", failure); setup.queue("/api/notifications", failure);
    await setup.advance(30_000);
    assert.match(textOf(setup.render()), /STALE|Retry/);
    assert.equal(setup.bell().props.disabled, false);
    assert.deepEqual(setup.resources(), { timers: 2, connected: 2, subscriptions: 3 });
    await setup.advance(30_000);
    assert.match(textOf(setup.render()), /LIVE/);
    assert.equal(setup.notificationCount(), 1);
    setup.unmount(); setup.assertDisposed();
  });
}

test("fresh authorized Admin mount loads only new notifications and rejects previous-session continuations", async () => {
  const setup = fixture(); setup.render(); await setup.ready();
  const callback = setup.shellCallback(), oldRequest = deferred<Reply>();
  setup.queue("/api/notifications", oldRequest.promise); callback(); await setup.ready();
  setup.queue("/api/dashboard/admin", { status: 401 }); await setup.advance(30_000); assertLost(setup, 401);
  setup.queue("/api/notifications", { body: notification("Fresh Admin notification") });
  setup.remount(); await setup.ready();
  assert.equal(setup.bell().props.disabled, false);
  assert.match(textOf(setup.render()), /LIVE/);
  assert.equal(setup.notificationTitles(), "Fresh Admin notification");
  const count = setup.requests.length; callback();
  oldRequest.resolve({ body: notification("Old session notification") }); await setup.ready();
  assert.equal(setup.requests.length, count);
  assert.equal(setup.notificationTitles(), "Fresh Admin notification", "old-session response cannot overwrite fresh notifications");
  await setup.bell().props.onClick(); await setup.ready();
  assert.doesNotMatch(textOf(setup.render()), /Old session notification/);
  setup.unmount(); setup.assertDisposed();
});

test("notification dropdown continuation cannot mark/read or navigate after Admin loss", async () => {
  const setup = fixture(); setup.render(); await setup.ready();
  const pending = deferred<Reply>(); setup.queue("/api/notifications", pending.promise);
  const opening = setup.bell().props.onClick(); await setup.ready();
  setup.queue("/api/dashboard/admin", { status: 401 }); await setup.advance(30_000);
  const count = setup.requests.length;
  pending.resolve({ body: notification() }); await opening;
  assert.equal(setup.requests.length, count, "no delayed mark-read PUT");
  assertLost(setup, 401); setup.unmount(); setup.assertDisposed();
});

test("unmount aborts notification/session fetches and suppresses all delayed callbacks", async () => {
  const setup = fixture(), notifications = deferred<Reply>(), session = deferred<Reply>();
  setup.queue("/api/notifications", notifications.promise); setup.queue("/api/auth/session", session.promise);
  setup.render(); await setup.ready(); setup.unmount();
  assert.equal(setup.requests.filter((request) => !request.settled).every((request) => request.signal?.aborted), true);
  notifications.resolve({ body: notification() }); session.resolve({ body: { user: { userId: "admin-id", role: "admin" } } });
  await setup.ready(); setup.assertDisposed();
});

for (const role of ["teacher", "student"] as const) {
  test(`mounted ${role} shell with only Admin cookie cannot adopt identity or notifications`, async () => {
    const auth = authFixture(); auth.cookies.set("ps_session_admin", auth.token("admin"));
    const setup = fixture(role, auth); setup.render(); await setup.ready();
    assert.equal(setup.notificationCount(), 0);
    assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
    const count = setup.requests.length; await setup.advance(45_000); assert.equal(setup.requests.length, count);
    assert.equal(setup.requests.every(request => request.url.includes(`scope=user&role=${role}`)), true);
    assert.deepEqual(setup.channelNames(), []); setup.unmount(); setup.assertDisposed();
  });
  test(`mounted valid ${role} shell uses strict endpoint and Pusher scope`, async () => {
    const auth = authFixture(); auth.cookies.set("ps_session_user", auth.token(role));
    const setup = fixture(role, auth); setup.render(); await setup.ready();
    assert.equal(setup.notificationTitles(), `${role} notification`);
    assert.deepEqual(setup.channelNames(), [`private-user-${role}`]);
    assert.deepEqual(setup.authEndpoints(), [`/api/pusher/auth?scope=user&role=${role}`]);
    assert.equal(setup.requests.every(request => request.url.includes(`scope=user&role=${role}`)), true);
    setup.unmount(); setup.assertDisposed();
  });
  test(`${role} shell rejects a mismatched successful identity response`, async () => {
    const setup = fixture(role);
    setup.queue("/api/auth/session", { body: { user: { userId: "admin-id", role: "admin" } } });
    setup.render(); await setup.ready();
    assert.equal(setup.notificationCount(), 0); assert.equal(setup.resources().connected, 0); assert.equal(setup.resources().timers, 0);
    setup.unmount(); setup.assertDisposed();
  });
  test(`${role} replacement session stops old queued callbacks and notification responses`, async () => {
    const setup = fixture(role); setup.render(); await setup.ready();
    const callback = setup.shellCallback("notification"), pending = deferred<Reply>();
    setup.queue("/api/notifications", pending.promise); callback(); await setup.ready();
    setup.queue("/api/notifications", { status: 401 }); await setup.advance(15_000);
    const count = setup.requests.length; callback(); await setup.advance(35_000);
    pending.resolve({ body: notification("Old session data") }); await setup.ready();
    assert.equal(setup.requests.length, count); assert.equal(setup.notificationCount(), 0);
    assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
    setup.unmount(); setup.assertDisposed();
  });
  test(`${role} shell retains its polling, user subscription, dropdown and transient-failure behavior`, async () => {
    const setup = fixture(role); setup.render(); await setup.ready();
    assert.deepEqual(setup.resources(), { timers: 1, connected: 1, subscriptions: 1 });
    setup.queue("/api/notifications", { status: 500 }); await setup.advance(15_000);
    assert.equal(setup.notificationCount(), 1);
    await setup.bell().props.onClick(); await setup.ready();
    assert.match(textOf(setup.render()), /Private Admin notification/);
    assert.equal(setup.requests.some((request) => request.method === "PUT"), true);
    setup.unmount(); setup.assertDisposed();
  });
}
