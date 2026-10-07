import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

export type SidebarRole = "student" | "teacher" | "admin";
type Node = { type: any; props: Record<string, any> };
type Hook = { value?: any; deps?: unknown[]; cleanup?: () => void };
export function sidebarNodes(value: any, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(value)) return value.flatMap((child) => sidebarNodes(child, predicate));
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  return [...(predicate(value) ? [value] : []), ...sidebarNodes(value.props.children, predicate)];
}
export function sidebarText(value: any): string {
  if (Array.isArray(value)) return value.map(sidebarText).join("");
  return value && typeof value === "object" && "props" in value ? sidebarText(value.props.children)
    : value == null || typeof value === "boolean" ? "" : String(value);
}
const escape = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function html(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(html).join("");
  if (typeof node !== "object") return escape(node);
  if (typeof node.type !== "string") return html(node.props.children);
  const attributes = Object.entries(node.props).filter(([key, value]) => !["children", "key", "ref"].includes(key) && !key.startsWith("on") && typeof value !== "function" && value != null && (value !== false || key.startsWith("aria-")))
    .map(([key, value]) => `${key === "className" ? "class" : key}="${escape(value)}"`).join(" ");
  return `<${node.type} ${attributes}>${html(node.props.children)}${["input", "img", "br"].includes(node.type) ? "" : `</${node.type}>`}`;
}

// Execute the actual shared shell and session modules. Only React scheduling,
// browser primitives and notification transport are simulated; no app services run.
export function sidebarFixture(role: SidebarRole, options: {
  storage?: Map<string, string>; systemDark?: boolean; initialDark?: boolean;
  storageUnavailable?: boolean; writeUnavailable?: boolean;
} = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const classes = new Set(options.initialDark ? ["dark"] : []);
  const hooks: Hook[] = [], effects: (() => void)[] = [];
  const modules = new Map<string, any>(), mediaListeners = new Set<() => void>();
  const documentListeners = new Map<string, Set<() => void>>(), timers = new Set<number>();
  const requests: { url: string; method: string }[] = [];
  let hookIndex = 0, timerId = 0, pathname = `/dashboard/${role}`;
  const slot = () => hooks[hookIndex++] ??= {};
  const media = { matches: options.systemDark ?? false,
    addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => mediaListeners.delete(listener) };
  const document = { documentElement: { classList: {
    add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name),
  } }, addEventListener: (name: string, listener: () => void) => { const group = documentListeners.get(name) ?? new Set(); group.add(listener); documentListeners.set(name, group); },
  removeEventListener: (name: string, listener: () => void) => documentListeners.get(name)?.delete(listener) };
  const window = { matchMedia: () => media, location: { href: "" } };
  const react = {
    createContext: (value: unknown) => ({ value, Provider: {} }),
    useContext: (context: any) => context.value,
    useState: (initial: any) => { const hook = slot(); if (!("value" in hook)) hook.value = typeof initial === "function" ? initial() : initial;
      return [hook.value, (next: any) => { hook.value = typeof next === "function" ? next(hook.value) : next; }]; },
    useRef: (initial: unknown) => { const hook = slot(); return hook.value ??= { current: initial }; },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const hook = slot();
      if (!hook.deps || deps.some((dependency, index) => !Object.is(dependency, hook.deps![index]))) {
        hook.deps = deps; effects.push(() => { hook.cleanup?.(); hook.cleanup = effect() || undefined; });
      }
    },
  };
  const jsx = (type: any, props: any) => typeof type === "function" ? type(props) : ({ type, props });
  const load = (file: string): any => {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, {
      exports, AbortController, console, process: { env: {} }, window, document,
      localStorage: { getItem: (key: string) => { if (options.storageUnavailable) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
        setItem: (key: string, value: string) => { if (options.storageUnavailable || options.writeUnavailable) throw new Error("Storage blocked"); storage.set(key, value); } },
      setInterval: () => { const id = ++timerId; timers.add(id); return id; }, clearInterval: (id: number) => timers.delete(id),
      fetch: async (url: string, init?: RequestInit) => { requests.push({ url, method: init?.method ?? "GET" });
        return { ok: true, status: 200, json: async () => ({ success: true, unreadCount: 0, notifications: [] }) }; },
      require(name: string) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "next/link") return { __esModule: true, default: "a" };
        if (name === "next/navigation") return { usePathname: () => pathname, useRouter: () => ({ push() {} }) };
        if (name === "clsx") return { clsx: (...values: unknown[]) => values.filter(Boolean).join(" ") };
        if (name === "lucide-react") return new Proxy({}, { get: (_target, icon) => (props: any) => jsx("svg", { ...props, "data-icon": String(icon), fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: jsx("path", { d: "M4 12h16M12 4v16" }) }) });
        if (name === "pusher-js") return { __esModule: true, default: class {} };
        if (name.startsWith("./")) return load("src/components/" + name.slice(2) + ".tsx");
        throw new Error("Unexpected sidebar dependency " + name);
      },
    });
    return exports;
  };
  const Shell = load("src/components/dashboard-shell.tsx").default;
  const render = () => { hookIndex = 0; return Shell({ role, userName: "Sidebar Fixture User", userInitials: "QA", children: jsx("p", { children: "Dashboard content retained" }) }); };
  const settle = async () => { await new Promise(setImmediate); };
  const click = async (label: string) => { const button = sidebarNodes(render(), (node) => node.type === "button" && (node.props["aria-label"] === label || sidebarText(node) === label))[0];
    if (!button) throw new Error("Missing sidebar action " + label); await button.props.onClick(); await settle(); };
  return { role, storage, classes, requests, render, click, window,
    html: () => html(render()),
    mount: async () => { render(); effects.splice(0).forEach((effect) => effect()); await settle(); },
    navigate: (next: string) => { pathname = next; return render(); },
    systemChange: (dark: boolean) => { media.matches = dark; [...mediaListeners].forEach((listener) => listener()); },
    listeners: () => mediaListeners.size,
    unmount: () => { hooks.forEach((hook) => { hook.cleanup?.(); hook.cleanup = undefined; }); },
  };
}
