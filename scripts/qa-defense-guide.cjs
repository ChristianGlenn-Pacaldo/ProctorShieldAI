const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const root = process.cwd();
  const source = path.resolve(root, 'docs/_working/ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.html');
  const pdf = path.resolve(root, 'docs/defense/ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.pdf');
  const outputDir = path.resolve(root, 'docs/_working/defense-browser-qa');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${source.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });

    const sections = await page.evaluate(() => {
      const children = Array.from(document.body.children);
      const starts = children
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => node.classList.contains('cover') || node.tagName === 'H1');
      return starts.map((start, i) => {
        const next = starts[i + 1];
        const label = start.node.classList.contains('cover')
          ? '00-cover'
          : (start.node.textContent || `section-${i}`).trim().toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 64);
        const endIndex = next ? next.index : children.length;
        const html = children.slice(start.index, endIndex).map((node) => node.outerHTML).join('\n');
        return { label, html, head: document.head.innerHTML };
      });
    });

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      const sectionPage = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });
      await sectionPage.setContent(`<!doctype html><html><head>${section.head}</head><body>${section.html}</body></html>`, { waitUntil: 'load' });
      await sectionPage.emulateMedia({ media: 'print' });
      await sectionPage.evaluate(() => document.fonts.ready);
      await sectionPage.waitForTimeout(75);
      const filename = `${String(i).padStart(2, '0')}-${section.label}.png`;
      await sectionPage.screenshot({ path: path.join(outputDir, filename), fullPage: true });
      await sectionPage.close();
    }

    console.log(`sections=${sections.length}`);
    console.log(`qa=${outputDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
