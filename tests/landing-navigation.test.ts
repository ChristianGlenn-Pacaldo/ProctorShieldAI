import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture(reducedMotion = false, restored = 0) {
  const listeners = new Map<string, { fn: (event?: unknown) => void; options?: { passive?: boolean } }>();
  const frames = new Map<number, () => void>(), timers = new Map<number, () => void>();
  let sequence = 0, closed = 0, headerHeight = 88, menuExtra = 0, disconnected = 0;
  const scrolls: Array<{ top: number; behavior: string }> = [], hashes: string[] = [];
  const historyState = { nextState: "preserved" };
  const attributes = () => {
    const attrs = new Map<string, string>();
    return { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => attrs.set(n, v),
      removeAttribute: (n: string) => attrs.delete(n), hasAttribute: (n: string) => attrs.has(n) };
  };
  const style = () => {
    const props = new Map<string, string>();
    return { getPropertyValue: (n: string) => props.get(n) ?? "", setProperty: (n: string, v: string) => props.set(n,v), removeProperty: (n: string) => props.delete(n) };
  };
  const window = {
    scrollY: restored, innerHeight: 800, location: { hash: "" },
    history: { state: historyState, pushState(state: unknown, _: string, hash: string) { assert.equal(state,historyState); hashes.push(hash); window.location.hash = hash; } },
    scrollTo: (options: { top: number; behavior: string }) => scrolls.push(options),
    matchMedia: () => motion,
    addEventListener: (name: string, fn: (event?: unknown) => void, options?: { passive?: boolean }) => listeners.set(name,{fn,options}),
    removeEventListener: (name: string) => listeners.delete(name),
    setTimeout: (fn: () => void) => { timers.set(++sequence,fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id),
  };
  const motion = { matches: reducedMotion, addEventListener: (_: string, fn: () => void) => { motionChange = fn; }, removeEventListener: () => { motionChange = undefined; } };
  let motionChange: (() => void) | undefined;
  class Element {
    target = ""; attributes = attributes();
    getAttribute = this.attributes.getAttribute; setAttribute = this.attributes.setAttribute;
    removeAttribute = this.attributes.removeAttribute; hasAttribute = this.attributes.hasAttribute;
    closest() { return this; }
  }
  const ids = ["features","how","pricing","faq"];
  const blurs = new Map<string, () => void>();
  const headings = ids.map(id => ({ id: `${id}-title`, ...attributes(), addEventListener(_: string, fn: () => void) { blurs.set(this.id,fn); }, removeEventListener() { blurs.delete(this.id); }, focus(options: { preventScroll: boolean }) { assert.equal(options.preventScroll,true); focused = this.id; } }));
  let focused = "";
  const sections = ids.map((id,i) => ({ id, getAttribute: () => `${id}-title`, getBoundingClientRect: () => ({ top: (i+1)*1000-window.scrollY+menuExtra }) }));
  const links = ids.map((id,i) => { const e = new Element(); e.setAttribute("href",`#${id}`); return Object.assign(e,{ getBoundingClientRect: () => ({ left: i*90+200, bottom: 50, width: 75 }) }); });
  const nav = { dataset: {} as Record<string,string>, style: style(), getBoundingClientRect: () => ({ left: 200, top: 30 }), querySelectorAll: () => links };
  const page = { style: style() };
  const bar = { getBoundingClientRect: () => ({ height: headerHeight }) };
  const headerEvents = new Map<string,(event: unknown)=>void>();
  const header = { getBoundingClientRect: () => ({height:headerHeight+1+menuExtra}), parentElement: page, querySelector: () => bar, querySelectorAll: () => [nav], contains: (e: unknown) => links.includes(e as typeof links[number]),
    addEventListener: (n: string, fn: (event: unknown)=>void) => headerEvents.set(n,fn), removeEventListener: (n: string) => headerEvents.delete(n) };
  let resize!: () => void, mutation!: () => void;
  const exports: { setupLandingNavigation?: (header: unknown, close: () => void) => () => void } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/landing-navigation.ts","utf8"),{
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, window, Element,
    document: { documentElement: { scrollHeight: 6000 }, getElementById: (id: string) => [...sections,...headings].find(s=>s.id===id) },
    requestAnimationFrame: (fn: () => void) => { frames.set(++sequence,fn); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { constructor(fn: () => void) { resize=fn; } observe() {} disconnect() { disconnected++; } },
    MutationObserver: class { constructor(fn: () => void) { mutation=fn; } observe() {} disconnect() { disconnected++; } },
  });
  const cleanup = exports.setupLandingNavigation!(header,()=>{closed++;menuExtra=0;});
  const flush = () => { for(const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  const event = (extra = {}) => ({ target: links[0], button: 0, defaultPrevented: false, metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,
    preventDefault() { this.defaultPrevented=true; }, ...extra });
  const click = (index: number, extra = {}) => { const e=event({target:links[index],...extra});headerEvents.get("click")!(e);return e; };
  const scroll = (y: number) => {window.scrollY=y;listeners.get("scroll")!.fn();flush();};
  const active = () => links.find(l=>l.getAttribute("aria-current")==="location")?.getAttribute("href");
  return {window, links, sections, headings, page, nav, frames, timers, listeners, headerEvents, motion, click, event, flush, scroll, scrolls, hashes, active, cleanup,
    blur:(id:string)=>blurs.get(id)?.(), focused:()=>focused, closed:()=>closed, resize:(h:number)=>{headerHeight=h;resize();flush();}, mutation:()=>mutation(), openMenu:()=>{menuExtra=150;mutation();flush();},
    motionChange:()=>motionChange?.(), disconnected:()=>disconnected };
}

test("all four actual destinations preserve hashes/history, close menu, focus heading and use measured smooth scroll",()=>{
  for(let i=0;i<4;i++) {
    const f=fixture();const e=f.click(i);assert.equal(e.defaultPrevented,true);assert.equal(f.closed(),1);
    assert.equal(f.active(),`#${f.sections[i].id}`);f.flush();
    assert.equal(f.hashes[0],`#${f.sections[i].id}`);assert.equal(f.focused(),`${f.sections[i].id}-title`);
    assert.equal(f.headings[i].getAttribute("tabindex"),"-1");f.blur(`${f.sections[i].id}-title`);assert.equal(f.headings[i].getAttribute("tabindex"),null);
    assert.equal(f.scrolls[0].top,(i+1)*1000-113);assert.equal(f.scrolls[0].behavior,"smooth");
    f.scroll(f.scrolls[0].top);assert.equal(f.active(),`#${f.sections[i].id}`);f.cleanup();
  }
});
test("modified/default-prevented/non-primary clicks keep native browser semantics",()=>{
  for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]) {
    const f=fixture();f.click(0,extra);f.flush();assert.equal(f.scrolls.length,0);assert.equal(f.hashes.length,0);assert.equal(f.closed(),0);f.cleanup();
  }
});
test("new-window and download links are not intercepted",()=>{
  const f=fixture();f.links[0].target="_blank";f.click(0);assert.equal(f.closed(),0);
  f.links[0].target="";f.links[0].setAttribute("download","");f.click(0);assert.equal(f.closed(),0);f.cleanup();
});
test("missing or unrelated destinations fail back to native anchors without navigation side effects",()=>{
  const f=fixture();f.links[0].setAttribute("href","#unknown");assert.equal(f.click(0).defaultPrevented,false);assert.equal(f.hashes.length,0);f.cleanup();
});
test("indicator stays on requested destination during smooth travel; manual input releases it",()=>{
  const f=fixture();f.click(3);f.flush();f.scroll(1500);assert.equal(f.active(),"#faq");
  f.listeners.get("wheel")!.fn();f.flush();assert.equal(f.active(),"#features");
  assert.equal(f.timers.size,0);f.cleanup();
});
test("manual scrolling selects visible sections without rewriting the URL and uses a boundary dead band",()=>{
  const f=fixture();f.scroll(900);assert.equal(f.active(),"#features");
  f.scroll(1888);assert.equal(f.active(),"#features");f.scroll(1900);assert.equal(f.active(),"#how");
  f.scroll(1882);assert.equal(f.active(),"#how");f.scroll(1878);assert.equal(f.active(),"#features");f.scroll(0);assert.equal(f.active(),undefined);
  assert.equal(f.hashes.length,0);f.cleanup();
});
test("reduced motion uses instant navigation and cancels pending animated selection on preference change",()=>{
  const f=fixture(true);f.click(1);f.flush();assert.equal(f.scrolls[0].behavior,"instant");
  f.motionChange();f.flush();assert.equal(f.timers.size,0);f.cleanup();
});
test("restored position, hash/history and page-show events read geometry without forcing scroll or resetting history",()=>{
  const f=fixture(false,2900);assert.equal(f.active(),"#pricing");
  for(const name of ["hashchange","popstate","pageshow"]) {f.window.scrollY=900;f.listeners.get(name)!.fn();f.flush();assert.equal(f.active(),"#features");}
  assert.equal(f.scrolls.length,0);assert.equal(f.hashes.length,0);f.cleanup();
});
test("resizing enlarged mobile navbar updates sticky offset; reopened menus receive current active attributes",()=>{
  const f=fixture(false,900);f.resize(180);assert.equal(f.page.style.getPropertyValue("--landing-nav-offset"),"205px");
  f.click(0);f.flush();assert.equal(f.scrolls[0].top,795);
  f.links[0].removeAttribute("aria-current");f.mutation();assert.equal(f.active(),"#features");f.cleanup();
});
test("repeated same-hash activation does not add duplicate history entries",()=>{
  const f=fixture();f.click(0);f.flush();f.click(0);f.flush();assert.equal(f.hashes.length,1);f.cleanup();
});
test("passive frame-coalesced scrolling and all observers/timers/listeners are cleaned up",()=>{
  const f=fixture();for(let i=0;i<10;i++)f.listeners.get("scroll")!.fn();assert.equal(f.frames.size,1);
  for(const name of ["scroll","wheel","touchstart"])assert.equal(f.listeners.get(name)!.options!.passive,true);
  assert.equal(f.listeners.has("touchmove"),false);f.click(1);f.flush();f.cleanup();
  assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.equal(f.headerEvents.size,0);
  assert.equal(f.disconnected(),2);assert.equal(f.page.style.getPropertyValue("--landing-nav-offset"),"");
});
test("navbar retains native named anchors, hidden decorative indicator and existing focus/reduced-motion protection",()=>{
  const source=fs.readFileSync("src/app/page.tsx","utf8"),css=fs.readFileSync("src/app/landing.module.css","utf8");
  assert.equal((source.match(/data-section-navigation=""/g)||[]).length,2);
  for(const id of ["features","how","pricing","faq"])assert.match(source,new RegExp(`href="#${id}"`));
  assert.match(source,/<span className=\{styles.navIndicator\} aria-hidden="true" \/>/);
  assert.match(source,/<ScrollExpandMedia className=\{styles.heroLogo\}><HeroLogoIntro \/><\/ScrollExpandMedia>/);
  assert.match(css,/\.navIndicator[\s\S]*background: var\(--ps-gold\)/);
  assert.match(css,/prefers-reduced-motion: reduce[\s\S]*\.navIndicator, \.mobileNav a::after \{ transition: none !important;/);
  assert.match(css,/\.mobileNav a \{ display: inline-flex;[\s\S]*min-height: 44px/);
});

test("direct and history-restored hashes select the exact aligned section inside the dead band",()=>{
  for (let i=0;i<4;i++) {
    const f=fixture();f.window.location.hash=`#${f.sections[i].id}`;
    f.window.scrollY=(i+1)*1000-113;f.listeners.get("popstate")!.fn();f.flush();
    assert.equal(f.active(),`#${f.sections[i].id}`);assert.equal(f.scrolls.length,0);f.cleanup();
  }
});

test("opening a mobile menu keeps the selected section active while its extra height shifts document flow",()=>{
  const f=fixture();f.window.location.hash="#features";f.scroll(887);assert.equal(f.active(),"#features");
  f.openMenu();assert.equal(f.active(),"#features");assert.equal(f.page.style.getPropertyValue("--landing-nav-offset"),"113px");f.cleanup();
});
