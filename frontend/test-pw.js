const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('request', request => {
    if (request.url().includes('.m3u8')) console.log('>>', request.method(), request.url());
  });
  
  await page.goto('https://vidsrc.icu/embed/tv/85552/1/3', { waitUntil: 'networkidle' });
  console.log('Page loaded. Waiting for 5 seconds...');
  await page.waitForTimeout(5000);
  await browser.close();
})();
