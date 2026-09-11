const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function main() {
  const root = process.cwd();
  const source = path.resolve(root, 'docs/_working/ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.html');
  const outputDir = path.resolve(root, 'docs/defense');
  const output = path.join(outputDir, 'ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.pdf');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${source.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    await page.pdf({
      path: output,
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="width:100%;font-family:Arial;font-size:8px;color:#64748b;text-align:right;padding:0 0.55in">ProctorShield AI Final Defense Study Guide</div>',
      footerTemplate: '<div style="width:100%;font-family:Arial;font-size:8px;color:#64748b;text-align:center"><span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '0.72in', right: '0.72in', bottom: '0.68in', left: '0.72in' },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
  console.log(`pdf=${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
