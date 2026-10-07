import assert from "node:assert/strict";
import test from "node:test";
import { sidebarFixture, sidebarNodes, sidebarText } from "./helpers/sidebar-theme-fixture.ts";

for (const role of ["student", "teacher", "admin"] as const) {
  test(role + " saved light clears a stale dark class and overrides the system preference", async () => {
    const page = sidebarFixture(role, { initialDark: true, systemDark: true, storage: new Map([["theme", "light"]]) });
    await page.mount(); assert.equal(page.classes.has("dark"), false);
    assert.equal(sidebarNodes(page.render(), (node) => node.props["aria-label"] === "Switch to dark theme").length, 1);
    page.systemChange(false); page.systemChange(true); assert.equal(page.classes.has("dark"), false); page.unmount();
  });
  test(role + " saved dark overrides light system and invalid preferences fall back to system", async () => {
    const saved = sidebarFixture(role, { storage: new Map([["theme", "dark"]]) }); await saved.mount();
    assert.equal(saved.classes.has("dark"), true); saved.unmount();
    const invalid = sidebarFixture(role, { initialDark: true, storage: new Map([["theme", "invalid"]]) }); await invalid.mount();
    assert.equal(invalid.classes.has("dark"), false); invalid.unmount();
  });
  test(role + " follows live system changes until an explicit choice and cleans up its listener", async () => {
    const page = sidebarFixture(role, { systemDark: true }); await page.mount();
    assert.equal(page.classes.has("dark"), true); assert.equal(page.storage.has("theme"), false);
    page.systemChange(false); assert.equal(page.classes.has("dark"), false);
    await page.click("Switch to dark theme"); assert.equal(page.classes.has("dark"), true);
    page.systemChange(true); page.systemChange(false); assert.equal(page.classes.has("dark"), true);
    assert.equal(page.listeners(), 1); page.unmount(); assert.equal(page.listeners(), 0);
    page.systemChange(false); assert.equal(page.classes.has("dark"), true);
  });
  test(role + " theme switches immediately and persists through navigation and fresh dashboard mounts", async () => {
    const storage = new Map<string, string>(), page = sidebarFixture(role, { storage }); await page.mount();
    await page.click("Switch to dark theme"); assert.equal(page.classes.has("dark"), true); assert.equal(storage.get("theme"), "dark");
    page.navigate(`/dashboard/${role}/settings`); assert.equal(page.classes.has("dark"), true);
    assert.match(sidebarText(page.render()), /Dashboard content retained/); page.unmount();
    const reloaded = sidebarFixture(role, { storage }); await reloaded.mount(); assert.equal(reloaded.classes.has("dark"), true);
    await reloaded.click("Switch to light theme"); assert.equal(reloaded.classes.has("dark"), false); assert.equal(storage.get("theme"), "light"); reloaded.unmount();
    const other = sidebarFixture(role === "student" ? "teacher" : "student", { storage, systemDark: true, initialDark: true });
    await other.mount(); assert.equal(other.classes.has("dark"), false); other.unmount();
  });
  test(role + " storage errors cannot stop mounting or changing the dashboard theme", async () => {
    const blocked = sidebarFixture(role, { storageUnavailable: true, systemDark: true }); await blocked.mount();
    assert.equal(blocked.classes.has("dark"), true); await blocked.click("Switch to light theme"); assert.equal(blocked.classes.has("dark"), false);
    blocked.systemChange(false); blocked.systemChange(true); assert.equal(blocked.classes.has("dark"), false); blocked.unmount();
    const readOnly = sidebarFixture(role, { writeUnavailable: true }); await readOnly.mount(); await readOnly.click("Switch to dark theme");
    assert.equal(readOnly.classes.has("dark"), true); readOnly.unmount();
  });
  test(role + " theme changes preserve role navigation, active items, dropdowns, and mobile sidebar state", async () => {
    const page = sidebarFixture(role); await page.mount(); await page.click("Open navigation menu"); await page.click("Open profile menu");
    const sidebar = () => sidebarNodes(page.render(), (node) => node.type === "aside")[0];
    const links = () => sidebarNodes(sidebar(), (node) => node.type === "a").map((node) => node.props.href);
    const before = links(); assert.ok(before.every((href) => href.startsWith(`/dashboard/${role}`)));
    await page.click("Switch to dark theme"); assert.deepEqual(links(), before);
    assert.match(sidebar().props.className, /(?:^| )translate-x-0(?: |$)/);
    assert.equal(sidebarNodes(page.render(), (node) => node.props["aria-label"] === "Close navigation menu")[0].props["aria-expanded"], true);
    assert.match(sidebarText(page.render()), /Profile & Settings/);
    page.navigate(`/dashboard/${role}/settings`);
    assert.equal(sidebarNodes(sidebar(), (node) => node.type === "a" && node.props.className.includes("dashboard-nav-active"))[0].props.href, `/dashboard/${role}/settings`);
    await page.click("Close navigation menu"); assert.match(sidebar().props.className, /-translate-x-full/); page.unmount();
  });
}
