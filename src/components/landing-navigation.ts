/** Landing navbar enhancement only: anchors remain usable without JavaScript. */
export function setupLandingNavigation(header: HTMLElement, closeMenu: () => void) {
  const ids = ["features", "how", "pricing", "faq"];
  const sections = ids.map(id => document.getElementById(id)).filter((s): s is HTMLElement => !!s);
  const bar = header.querySelector<HTMLElement>("[data-nav-bar]");
  const page = header.parentElement;
  if (!sections.length || !bar || !page) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = "", frame = 0, navigationFrame = 0, releaseTimer = 0, pending = "", initialized = false;
  let releaseFocus: (() => void) | undefined;
  const priorOffset = page.style.getPropertyValue("--landing-nav-offset");
  const offset = () => bar.getBoundingClientRect().height + 25;
  const targetTop = (section: HTMLElement) => Math.max(0, Math.min(
    section.getBoundingClientRect().top + window.scrollY - offset(),
    document.documentElement.scrollHeight - window.innerHeight,
  ));

  const paint = (id: string) => {
    active = id;
    for (const nav of header.querySelectorAll<HTMLElement>("[data-section-navigation]")) {
      const links = nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]');
      let selected: HTMLAnchorElement | undefined;
      for (const link of links) {
        if (link.getAttribute("href") === `#${id}`) {
          link.setAttribute("aria-current", "location"); selected = link;
        } else link.removeAttribute("aria-current");
      }
      nav.dataset.hasActive = String(!!selected);
      if (selected) {
        const parent = nav.getBoundingClientRect(), link = selected.getBoundingClientRect();
        nav.style.setProperty("--nav-x", `${link.left - parent.left}px`);
        nav.style.setProperty("--nav-width", `${link.width}px`);
        nav.style.setProperty("--nav-y", `${link.bottom - parent.top + 5}px`);
      }
    }
  };
  const clearPending = () => { pending = ""; window.clearTimeout(releaseTimer); };
  const update = () => {
    frame = 0;
    page.style.setProperty("--landing-nav-offset", `${offset()}px`);
    if (pending) {
      const target = sections.find(s => s.id === pending);
      if (target && Math.abs(window.scrollY - targetTop(target)) > 2) return;
      clearPending();
    }
    // A small dead band keeps the indicator steady near section boundaries.
    const line = header.getBoundingClientRect().height + 24;
    let next = "";
    for (const section of sections) if (section.getBoundingClientRect().top <= line + (initialized ? -8 : 2)) next = section.id;
    initialized = true;
    const current = sections.find(s => s.id === active);
    if (current && current.getBoundingClientRect().top <= line + 8 &&
        ids.indexOf(next) < ids.indexOf(active)) next = active;
    const anchored = sections.find(s => `#${s.id}` === window.location.hash && Math.abs(s.getBoundingClientRect().top - line) <= 2);
    if (anchored) next = anchored.id;
    if (next !== active) paint(next);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const interrupt = () => { clearPending(); schedule(); };
  const keys = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape"].includes(event.key)) interrupt();
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('[data-section-navigation] a[href^="#"]') : null;
    if (!link || !header.contains(link) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const section = sections.find(s => `#${s.id}` === link.getAttribute("href"));
    if (!section) return;
    event.preventDefault();
    clearPending(); cancelAnimationFrame(navigationFrame);
    paint(section.id); pending = section.id;
    closeMenu();
    const hash = `#${section.id}`;
    if (window.location.hash !== hash) window.history.pushState(window.history.state, "", hash);
    // Wait for the mobile menu to close before measuring/focusing the destination.
    navigationFrame = requestAnimationFrame(() => {
      navigationFrame = 0;
      const heading = document.getElementById(section.getAttribute("aria-labelledby") ?? "");
      if (heading) {
        releaseFocus?.();
        const previous = heading.getAttribute("tabindex");
        const restoreFocus = () => {
          if (previous === null) heading.removeAttribute("tabindex"); else heading.setAttribute("tabindex", previous);
          heading.removeEventListener("blur", restoreFocus); releaseFocus = undefined;
        };
        releaseFocus = restoreFocus;
        heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true });
        heading.addEventListener("blur", restoreFocus, { once: true });
      }
      window.scrollTo({ top: targetTop(section), behavior: reduced.matches ? "instant" : "smooth" });
      releaseTimer = window.setTimeout(() => { clearPending(); schedule(); }, 1800);
      schedule();
    });
  };
  const refresh = () => { paint(active); schedule(); };
  const observer = new ResizeObserver(refresh);
  observer.observe(bar);
  for (const section of sections) observer.observe(section);
  const menus = new MutationObserver(refresh);
  menus.observe(header, { childList: true, subtree: true });
  header.addEventListener("click", click);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", refresh, { passive: true });
  window.addEventListener("hashchange", interrupt);
  window.addEventListener("popstate", interrupt);
  window.addEventListener("pageshow", interrupt);
  window.addEventListener("wheel", interrupt, { passive: true });
  window.addEventListener("touchstart", interrupt, { passive: true });
  window.addEventListener("keydown", keys);
  reduced.addEventListener("change", interrupt);
  update(); // Read restored geometry; never force direct hashes/history to the top.
  return () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(navigationFrame); clearPending();
    releaseFocus?.(); observer.disconnect(); menus.disconnect(); header.removeEventListener("click", click);
    window.removeEventListener("scroll", schedule); window.removeEventListener("resize", refresh);
    window.removeEventListener("hashchange", interrupt); window.removeEventListener("popstate", interrupt);
    window.removeEventListener("pageshow", interrupt); window.removeEventListener("wheel", interrupt);
    window.removeEventListener("touchstart", interrupt); window.removeEventListener("keydown", keys);
    reduced.removeEventListener("change", interrupt);
    if (priorOffset) page.style.setProperty("--landing-nav-offset", priorOffset); else page.style.removeProperty("--landing-nav-offset");
  };
}
