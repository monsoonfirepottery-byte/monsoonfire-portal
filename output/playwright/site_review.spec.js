const { test } = require('playwright/test');
const fs = require('fs');

test('monsoonfire first-time visitor flow', async ({ browser }) => {
  const results = {
    checkedAt: new Date().toISOString(),
    desktop: {},
    mobile: {},
    errors: { pageErrors: [], requestFailures: [], consoleErrors: [] }
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', (err) => results.errors.pageErrors.push(String(err.message || err)));
  page.on('requestfailed', (req) => results.errors.requestFailures.push({ url: req.url(), error: req.failure()?.errorText || 'failed' }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') results.errors.consoleErrors.push(msg.text());
  });

  const resp = await page.goto('https://monsoonfire.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  results.desktop.status = resp?.status() ?? null;
  results.desktop.url = page.url();
  results.desktop.title = await page.title();
  results.desktop.h1 = await page.locator('h1').first().innerText();
  results.desktop.ctas = await page.locator('a,button').evaluateAll((els) =>
    els
      .map((el) => ({ text: (el.textContent || '').trim(), href: el.tagName === 'A' ? el.getAttribute('href') : null }))
      .filter((el) => el.text && /kiln|studio|community|book|reserve|login|support|contact/i.test(el.text))
      .slice(0, 20)
  );

  await page.screenshot({ path: 'output/playwright/monsoonfire-home-desktop-interactive.png', fullPage: true });

  const kilnLink = page.getByRole('link', { name: /kiln firing|kiln rentals/i }).first();
  if (await kilnLink.count()) {
    await kilnLink.click();
    await page.waitForTimeout(1200);
    results.desktop.kilnPage = { url: page.url(), title: await page.title() };
    await page.screenshot({ path: 'output/playwright/monsoonfire-kiln-from-home-desktop.png', fullPage: true });
  }

  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  const mResp = await mobilePage.goto('https://monsoonfire.com', { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForTimeout(1200);

  results.mobile.status = mResp?.status() ?? null;
  results.mobile.url = mobilePage.url();
  results.mobile.title = await mobilePage.title();
  results.mobile.hero = await mobilePage.locator('h1').first().innerText();

  const headerButtons = mobilePage.locator('header button, nav button, button');
  results.mobile.buttonCount = await headerButtons.count();
  await mobilePage.screenshot({ path: 'output/playwright/monsoonfire-home-mobile-interactive.png', fullPage: false });

  if ((await headerButtons.count()) > 1) {
    await headerButtons.nth(1).click({ force: true });
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({ path: 'output/playwright/monsoonfire-home-mobile-menu-attempt.png', fullPage: false });
    results.mobile.afterMenuAttemptUrl = mobilePage.url();
  }

  await mobileContext.close();

  fs.writeFileSync('output/playwright/monsoonfire-review-results.json', JSON.stringify(results, null, 2));
});

