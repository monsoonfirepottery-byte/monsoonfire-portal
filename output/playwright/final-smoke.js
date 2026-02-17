const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto('http://127.0.0.1:4173/support/', { waitUntil: 'networkidle' });
  await page.click('[data-topic="pricing"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'output/playwright/final-support-mobile-pricing-filter.png', fullPage: true });

  await page.goto('http://127.0.0.1:4173/contact/', { waitUntil: 'networkidle' });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'output/playwright/final-contact-mobile-validation.png', fullPage: true });

  await browser.close();
})();
