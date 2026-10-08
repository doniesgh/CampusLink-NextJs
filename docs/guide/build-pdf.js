// Builds docs/CampusLink-Guide-Equipe.pdf from docs/guide/guide-equipe.html with the Chromium of the test suite.
// Usage (repo root): node docs/guide/build-pdf.js   (requires: cd tests && npm install && npx playwright install chromium)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'tests', 'node_modules', '@playwright', 'test'));

const SOURCE = path.join(__dirname, 'guide-equipe.html');
const OUTPUT = path.join(__dirname, '..', 'CampusLink-Guide-Equipe.pdf');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${SOURCE.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.pdf({
    path: OUTPUT,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:8px;color:#5b6474;padding:0 18mm;display:flex;justify-content:space-between;">
      <span>CampusLink — Guide de l'équipe</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await browser.close();
  console.log(`PDF written: ${OUTPUT}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
