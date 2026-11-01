#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { parseArgs, resolveStaffCredentials, mintPortalStaffIdToken, installRefreshTokenSignInRoute, signInWithEmail } from './portal-authenticated-canary.mjs';

const options = parseArgs(process.argv.slice(2));
const credentials = await resolveStaffCredentials(options);
options.staffEmail = credentials.staffEmail;
options.staffUid = credentials.staffUid;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(options.baseUrl);
  const minted = await mintPortalStaffIdToken(options, credentials);
  const route = await installRefreshTokenSignInRoute(page, {
    apiKey: options.browserFirebaseApiKey, email: credentials.staffEmail, uid: credentials.staffUid,
    idToken: minted.token, refreshToken: minted.refreshToken || credentials.staffRefreshToken,
  });
  try {
    await signInWithEmail(page, credentials.staffEmail, '', { allowPlaceholderPassword: true });
    if (!route.wasHandled()) throw Error('Auth bootstrap was not intercepted');
  } finally { await route.remove(); }
  await mkdir(options.outputDir, { recursive: true });
  await page.goto(options.baseUrl + '/ware-check-in');
  await page.getByRole('button', { name: 'Glaze fire', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Whole-kiln space' }).click();
  await page.getByText(/whole kiln space: \$120\.00/i).waitFor();
  await page.screenshot({ path: options.outputDir + '/pricing-mid.png', fullPage: true });
  await page.getByRole('button', { name: 'Bisque fire', exact: true }).click();
  await page.getByText(/whole kiln space: \$80\.00/i).waitFor();
  await page.screenshot({ path: options.outputDir + '/pricing-low.png', fullPage: true });
  console.log('PASS: authenticated live pricing, mid $120 / low $80; no ticket submitted.');
} finally { await browser.close(); }
