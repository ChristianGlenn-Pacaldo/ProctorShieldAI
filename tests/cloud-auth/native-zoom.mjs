import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { ORIGIN, RESULTS, check, sanitize } from './runtime.mjs';

export async function nativeZoomChecks() {
  const extension = path.resolve('tests/cloud-auth/zoom-extension');
  const cases = [];
  let browser;
  let zoomAvailable = false;
  try {
    fs.mkdirSync('/tmp/psai-native-config', { recursive: true });
    fs.mkdirSync('/tmp/psai-native-cache', { recursive: true });
    browser = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
      env: { ...process.env, XDG_CONFIG_HOME: '/tmp/psai-native-config', XDG_CACHE_HOME: '/tmp/psai-native-cache' },
      viewport: null, args: ['--window-size=1280,1000', '--disable-dev-shm-usage', '--disable-extensions-except=' + extension, '--load-extension=' + extension] });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 10_000 });
    const page = await browser.newPage();
    const cdp = await browser.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    await page.goto(ORIGIN + '/login/student', { waitUntil: 'domcontentloaded' });
    const baseline = await page.evaluate(() => ({ width: window.innerWidth, ratio: window.devicePixelRatio, scale: window.visualViewport?.scale }));
    const zoom = await worker.evaluate(`async () => {
      const tabs = await chrome.tabs.query({url:'https://127.0.0.1:3443/*'});
      const tab = tabs.find(value => value.url.includes('/login/student'));
      if (!tab?.id) throw new Error('Owned login tab unavailable');
      await chrome.tabs.setZoomSettings(tab.id, {mode:'automatic',scope:'per-tab'});
      await chrome.tabs.setZoom(tab.id,2);
      return await chrome.tabs.getZoom(tab.id);
    }`);
    await page.waitForTimeout(250);
    const enlarged = await page.evaluate(() => ({ width: window.innerWidth, ratio: window.devicePixelRatio, scale: window.visualViewport?.scale }));
    check(zoom === 2 && Math.abs(enlarged.ratio / baseline.ratio - 2) < 0.1 && Math.abs(enlarged.width * 2 - baseline.width) < 3, 'Native browser zoom could not be independently proven');
    zoomAvailable = true;
    const evidence = { browserZoomAPI: zoom, baseline, enlarged, CSSZoomModified: false, textSizeModified: false };
    for (const width of [320, 375, 390]) for (const theme of ['light', 'dark']) for (const route of ['/login/student', '/login/teacher', '/login/forgot-password?role=student', '/login/forgot-password?role=teacher']) {
      for (const factor of [1, 2]) {
        // At 200% native zoom, a 640 physical CSS-pixel window produces a 320 CSS-pixel layout.
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: width * factor, height: 1050 * factor } });
        await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded' });
        await worker.evaluate(`async ({factor,url}) => {
          const tabs=await chrome.tabs.query({url:'https://127.0.0.1:3443/*'});
          const tab=tabs.find(value=>value.url===url);
          await chrome.tabs.setZoom(tab.id,factor);
          return await chrome.tabs.getZoom(tab.id);
        }`, { factor, url: page.url() });
        await page.evaluate(theme => { localStorage.setItem('theme', theme); document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
        await page.waitForTimeout(150);
        const measurements = await page.evaluate(() => {
          const nodes = [...document.querySelectorAll('h1,h2,label,input,button[type="submit"]')].filter(node => node.getBoundingClientRect().width > 0);
          const clipped = nodes.filter(node => {
            const box = node.getBoundingClientRect();
            return box.left < -1 || box.right > window.innerWidth + 1 || node.scrollWidth > node.clientWidth + 2;
          }).length;
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, ratio: devicePixelRatio, clipped };
        });
        const nativeFactor = await worker.evaluate(`async url => {const tabs=await chrome.tabs.query({url:'https://127.0.0.1:3443/*'});return chrome.tabs.getZoom(tabs.find(value=>value.url===url).id)}`, page.url());
        check(nativeFactor === factor && Math.abs(measurements.width - width) < 3, 'Native zoom layout width mismatch');
        check(measurements.scrollWidth <= measurements.width + 1 && measurements.clipped === 0, 'Actual text/control clipping or horizontal overflow at native zoom');
        await page.locator('input').first().focus();
        check(await page.locator('input').first().evaluate(node => document.activeElement === node), 'Keyboard focus lost');
        await page.keyboard.press('Tab');
        check(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard tab order lost');
        const name = route.includes('forgot') ? (route.includes('teacher') ? 'teacher-recovery' : 'student-recovery') : route.endsWith('teacher') ? 'teacher-login' : 'student-login';
        const screenshot = `${name}-${theme}-${width}-native-${factor}00.png`;
        await page.screenshot({ path: RESULTS + '/' + screenshot, fullPage: true });
        cases.push({ page: name, theme, CSSLayoutWidth: width, physicalViewportWidth: width * factor, nativeFactor, measurements, keyboardFocus: 'PASS', screenshot });
      }
    }
    return { status: 'PASS', actualNativeZoom: evidence, cases, GoogleButtonContainment: 'UNVERIFIED: real Google configuration and external SDK unavailable' };
  } catch (error) {
    const defect = /Actual text\/control clipping|Keyboard focus lost|Keyboard tab order lost/.test(error.message || '');
    return { status: zoomAvailable && defect ? 'FAIL' : 'BLOCKED', cases, message: sanitize(error.message || 'Native zoom unavailable'), GoogleButtonContainment: 'UNVERIFIED' };
  } finally { if (browser) await browser.close(); }
}
