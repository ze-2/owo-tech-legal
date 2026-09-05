/** Record real Playwright-rendered pages into a captioned MP4. No assessment submission. */
import { chromium, expect, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parsePackage } from '../cjts-prefiling/transfer.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const output = path.resolve(process.env.RECORDING_DIR || 'artifacts/user-flow');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const liveURL = 'https://cjts.judiciary.gov.sg/prefiling/prefilingAssessment';
mkdirSync(output, { recursive: true });
const staged = mkdtempSync(path.join(tmpdir(), 'clearclaim-recording-'));
cpSync(path.resolve('cjts-prefiling'), staged, { recursive: true });
const manifestPath = path.join(staged, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
// Headless Chrome cannot grant activeTab via a toolbar gesture. Stage this
// recording-only permission; the shipped extension remains unchanged.
manifest.host_permissions = ['https://cjts.judiciary.gov.sg/*'];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const browser = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`],
});
const displayBrowser = await chromium.launch({ channel: 'chromium', headless: true });
const display = await displayBrowser.newPage({ viewport: { width: 1600, height: 1080 } });
await display.setContent('<html><body style="margin:0;background:#11271e"><canvas width="1600" height="1080"></canvas></body></html>');
const videoEnv = { ...process.env };
// Nix-packaged FFmpeg uses its own linked libraries, not Chromium's runtime overrides.
if (videoEnv.NIX_LD) delete videoEnv.LD_LIBRARY_PATH;
const encoder = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '4', '-vcodec', 'png', '-i', 'pipe:0',
  '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, 'clearclaim-user-flow.mp4')],
{ stdio: ['pipe', 'ignore', 'pipe'], env: videoEnv });
let encoderError = '';
encoder.stderr.on('data', (chunk) => { encoderError += chunk.toString(); });
encoder.on('error', (error) => { encoderError += error.message; });
const encoderDone = once(encoder, 'close');
const chapters: Array<{ seconds: number; title: string }> = [];
let left: Page | null = null, right: Page | null = null, title = 'Clearclaim · complete preparation and assessment workflow';
let leftLabel = 'WEBPAGE';
const rightLabel = 'CHROME EXTENSION';
let frames = 0, recording = true, captureError: unknown = null;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function chapter(next: string) {
  title = next;
  chapters.push({ seconds: frames / 4, title });
  console.log(next);
}
async function capture() {
  const [l, r] = await Promise.all([left?.screenshot(), right?.screenshot()]);
  await display.evaluate(async ({ l, r, title, leftLabel, rightLabel }) => {
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#11271e'; ctx.fillRect(0, 0, 1600, 1080);
    ctx.fillStyle = '#f2f5ed'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(title, 28, 45, 1540);
    ctx.font = '16px sans-serif'; ctx.fillStyle = '#bed1c2';
    ctx.fillText('Fictional demonstration · live public SCT assessment · nothing submitted', 28, 78);
    const images: Array<[string | undefined, number, number, number, number]> = r
      ? [[l, 24, 128, 1080, 900], [r, 1128, 128, 420, 900]]
      : [[l, 80, 128, 1440, 900]];
    ctx.fillText(leftLabel, r ? 24 : 80, 115);
    if (r) ctx.fillText(rightLabel, 1128, 115);
    for (const [data, x, y, width, height] of images) {
      if (!data) continue;
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      ctx.drawImage(image, x, y, width, height);
    }
    ctx.fillStyle = '#bed1c2'; ctx.font = '15px sans-serif';
    ctx.fillText('Webpage → approved JSON → extension → native CJTS fields → user review', 28, 1060);
  }, { l: l?.toString('base64'), r: r?.toString('base64'), title, leftLabel, rightLabel });
  const image = await display.screenshot();
  if (!encoder.stdin.write(image)) await once(encoder.stdin, 'drain');
  frames++;
}
const captureLoop = (async () => {
  while (recording) {
    if (!left) { await delay(100); continue; }
    const started = Date.now();
    try { await capture(); } catch (error) { captureError = error; console.error('Capture failed:', error); break; }
    await delay(Math.max(0, 250 - (Date.now() - started)));
  }
})();
const hold = async (ms = 1800) => { await delay(ms); if (captureError) throw captureError; };
const answers: Array<{ question: string; answer: string }> = [];
let completed = false;
try {
  const manager = await browser.newPage();
  await manager.goto('chrome://extensions');
  const id = await manager.locator('extensions-item').filter({ hasText: 'Clearclaim' }).getAttribute('id');
  assertPresent(id, 'Extension must be loaded');
  await manager.close();
  const app = await browser.newPage();
  await app.goto(baseURL);
  left = app;
  chapter('1 · Describe the dispute and attach a record');
  await hold();
  const story = 'Claimant: Example Buyer Pte. Ltd.\nRespondent: Example Office Supplies Pte. Ltd.\nClaim type: Sale of goods\nIncident date: 2026-03-12\nClaim amount: 25000\n\nThis is a fictional demonstration. Our company paid SGD 25,000 for office equipment. The equipment delivered on 12 March 2026 did not match the written specifications. We requested a refund. Both companies are registered in Singapore and neither is in liquidation. We have a recent ACRA record, the written contract and a signed memorandum of consent. There is no arbitration clause. This is one complete invoice, with no profit-sharing or consignment arrangement.';
  await app.getByLabel('What’s the problem?', { exact: true }).fill(story);
  await app.getByLabel('What outcome would help?', { exact: true }).fill('Refund of SGD 25,000 for the fictional equipment order.');
  await app.getByLabel('Attach evidence files').setInputFiles({ name: 'fictional-order.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional demonstration record: office equipment, SGD 25,000, delivery 12 March 2026. The delivered equipment differs from the written specifications. Both parties signed a memorandum of consent.') });
  await app.getByLabel('What fictional-order.txt shows').fill('Fictional written order, delivery date and agreed specifications.');
  await hold();
  await app.getByRole('button', { name: 'Organise my claim', exact: true }).click();
  await expect(app.getByLabel('Your details (claimant)')).toHaveValue('Example Buyer Pte. Ltd.');
  chapter('2 · Review the editable claim particulars');
  await hold();
  await app.getByLabel('You are claiming as').selectOption('entity');
  await app.getByLabel('Both parties have signed a Memorandum of Consent').check();
  await app.getByLabel('Cause-of-action date').fill('2026-03-12');
  await app.getByLabel('Timeline').fill('12 March 2026 — Equipment delivered with different specifications; refund requested.');
  await app.getByLabel('Can the respondent be served in Singapore?').selectOption('yes');
  await app.getByLabel('What has the other party said?').fill('The supplier acknowledged the request and has not provided the refund.');
  await hold();
  await app.getByRole('button', { name: 'Review official guidance', exact: true }).click();
  chapter('3 · Read the official-source reference guidance');
  await expect(app.locator('.research-card')).toHaveCount(5);
  await app.locator('.research-card').first().scrollIntoViewIfNeeded();
  await hold(2500);
  await app.getByRole('button', { name: 'Prepare my filing pack', exact: true }).click();
  chapter('4 · Review and approve the exact values to transfer');
  await hold();
  const fieldNames = ['Claimant particulars', 'Respondent particulars', 'Claim amount', 'Claim category', 'Description of claim', 'Requested outcome', 'Cause-of-action date', 'Chronology'];
  for (const field of fieldNames) {
    await app.getByLabel(`Approve ${field}`, { exact: true }).check();
    await hold(500);
  }
  await app.getByLabel('Approve CJTS subtype Others', { exact: true }).check();
  const downloadPromise = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Export approved filing JSON', exact: true }).click();
  const downloaded = await downloadPromise;
  const jsonPath = path.join(output, 'clearclaim-approved-filing.json');
  await downloaded.saveAs(jsonPath);
  const pack = parsePackage(readFileSync(jsonPath, 'utf8'));
  if (Object.keys(pack.fields).length !== 8) throw new Error('Expected eight approved exported fields');
  chapter('5 · Download the approved JSON package');
  await hold(2500);

  const portal = await browser.newPage();
  await portal.setViewportSize({ width: 1080, height: 900 });
  await portal.addInitScript(() => sessionStorage.setItem('TribunalType', 'SCT'));
  await portal.goto(liveURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await portal.locator('app-sct-prefiling input[type=checkbox]').first().waitFor({ state: 'attached' });
  const popup = await browser.newPage();
  await popup.setViewportSize({ width: 420, height: 900 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await portal.bringToFront();
  left = portal; right = popup; leftLabel = 'LIVE CJTS · cjts.judiciary.gov.sg';
  chapter('6 · Import the webpage JSON into the Chrome extension');
  await popup.locator('#package').setInputFiles(jsonPath);
  await expect(popup.locator('#status')).toContainText('reviewed SCT subtype selected');
  await hold(2500);
  chapter('7 · Imported subtype is selected automatically');
  await hold();
  await expect(portal.locator('[name=d2]')).toHaveValue('12/03/2026', { timeout: 15000 });
  await expect(portal.locator('#cAmount')).toHaveValue('25,000.00', { timeout: 15000 });
  chapter('8 · Amount and exact date fill through native CJTS controls');
  await portal.locator('#cAmount').scrollIntoViewIfNeeded();
  await popup.locator('#progress-fields').scrollIntoViewIfNeeded();
  await hold(2500);
  await popup.getByLabel('Sale of goods: specify Others', { exact: true }).fill('Delivered equipment differs from specifications');
  await popup.locator('#fill-progress').dispatchEvent('click');
  await expect(portal.locator('[name=salesOthersDesc]')).toHaveValue('Delivered equipment differs from specifications');
  chapter('9 · Complete the newly revealed Others description');
  await hold();

  for (let index = 0; index < 35; index++) {
    await expect(async () => {
      const count = await popup.locator('#questions legend').count();
      const submit = portal.getByRole('button', { name: 'Submit', exact: true });
      if (!count && !(await submit.isEnabled())) throw new Error('Waiting for the next question');
    }).toPass({ timeout: 15000 });
    const legends = popup.locator('#questions legend');
    if (!(await legends.count())) {
      await expect(portal.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
      completed = true;
      break;
    }
    const question = (await legends.first().innerText()).trim();
    const answer = answerForFictionalScenario(question);
    chapter(`10 · Answer ${index + 1}: ${answer} — follow the next revealed question`);
    await popup.locator('#questions').scrollIntoViewIfNeeded();
    const portalButtons = portal.locator('#claimAmountConsent .form-group, #questions1Row .form-group')
      .filter({ has: portal.getByRole('button', { name: 'Yes', exact: true }) });
    if (await portalButtons.count()) await portalButtons.last().scrollIntoViewIfNeeded();
    await hold(2200);
    await portal.bringToFront();
    await popup.locator('#questions fieldset').first().getByRole('button', { name: answer, exact: true }).dispatchEvent('click');
    answers.push({ question, answer });
    await expect(legends.filter({ hasText: question })).toHaveCount(0, { timeout: 5000 });
  }
  if (!completed) throw new Error('The assessment did not reach final review');
  chapter('11 · Final review on CJTS — no submission performed');
  await portal.getByRole('button', { name: 'Submit', exact: true }).scrollIntoViewIfNeeded();
  await popup.locator('#progress-status').scrollIntoViewIfNeeded();
  await hold(3500);
  if (portal.url() !== liveURL) throw new Error('Unexpected navigation away from the assessment');
  await portal.screenshot({ path: path.join(output, 'final-cjts.png'), fullPage: true });
  await popup.screenshot({ path: path.join(output, 'final-extension.png'), fullPage: true });
} finally {
  recording = false;
  await captureLoop;
  encoder.stdin.end();
  const [code] = await encoderDone;
  writeFileSync(path.join(output, 'chapters.json'), JSON.stringify({ completed, fps: 4, durationSeconds: frames / 4, chapters, answers, submitted: false }, null, 2));
  await browser.close();
  await displayBrowser.close();
  if (captureError) throw captureError;
  if (code !== 0) throw new Error(`Video encoding failed: ${encoderError}`);
}
if (captureError) throw captureError;
console.log(`Recording saved: ${path.join(output, 'clearclaim-user-flow.mp4')}`);

function assertPresent(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function answerForFictionalScenario(question: string): 'Yes' | 'No' {
  // Explicit facts for this fictional corporate equipment dispute. An unfamiliar
  // question stops the recording rather than receiving a blanket default answer.
  const no = [/claiming as an individual/i, /liquidation|winding.up|bankrupt/i, /other party an individual/i,
    /mediation\/arbitration clause/i, /on or before 31 Oct 2018/i, /splitting or dividing/i, /profit or commission/i, /consignment/i];
  const yes = [/signed memorandum of consent/i, /correct party.*contractual obligation/i, /recent.*ACRA record/i,
    /contract for goods sold\/bought/i, /evidenced in writing/i, /credit term or delivery date lapsed/i,
    /Were the goods delivered/i, /seeking a Money Order/i, /residing\/located in Singapore/i,
    /locate and personally serve/i];
  if (no.some((pattern) => pattern.test(question))) return 'No';
  if (yes.some((pattern) => pattern.test(question))) return 'Yes';
  throw new Error(`Add an explicit fictional-scenario answer for: ${question}`);
}
