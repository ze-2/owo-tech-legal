import { test, expect } from '@playwright/test';
import { loadExtension } from './extension-harness';
import { assistProgress } from '../../cjts-prefiling/progressive-assist.mjs';

for (const [group, label, name] of [
  ['goods', 'Sale of goods', 'salesOthersDesc'],
  ['services', 'Provision of services', 'serviceOthersDesc'],
  ['property', 'Damage to property', 'damagedOthersDesc'],
  ['residential', 'Residential lease', 'rentalOthersDesc'],
]) {
  test(`progressive ${group} assessment fills delayed fields, date, Others and successive questions`, async ({ baseURL }) => {
    test.skip(test.info().project.name !== 'desktop', 'Desktop extension');
    const { context, id } = await loadExtension('cjts-prefiling', true);
    try {
      const portal = await context.newPage();
      await portal.goto(`${baseURL}/mock-sct.html?dynamic=1`);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await portal.bringToFront();
      await popup.locator('#package').setInputFiles({ name: 'approved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
        version: 2, generatedAt: new Date().toISOString(), userReviewed: true,
        fields: { amount: { value: '25000', review: 'approved', provenance: 'user' }, incidentDate: { value: '2026-03-12', review: 'approved', provenance: 'user' } },
        assessment: { sctOptions: [{ groupId: group, label: 'Others' }] },
      })) });
      await expect(portal.locator('#cAmount')).toHaveValue('25000');
      await expect(portal.locator('[name=d2]')).toHaveValue('12/03/2026');
      await expect(popup.getByLabel(`${label}: specify Others`, { exact: true })).toBeVisible();
      await popup.getByLabel(`${label}: specify Others`, { exact: true }).fill('Fictional test dispute');
      await popup.locator('#fill-progress').dispatchEvent('click');
      await expect(portal.locator(`[name=${name}]`)).toHaveValue('Fictional test dispute');
      await expect(popup.locator('#questions legend')).toContainText('signed memorandum');
      await popup.locator('#questions').getByRole('button', { name: 'Yes', exact: true }).dispatchEvent('click');
      await expect(popup.locator('#questions legend')).toContainText('proposed resolution');
      await popup.locator('#questions').getByRole('button', { name: 'No', exact: true }).dispatchEvent('click');
      await expect(popup.locator('#questions legend')).toContainText('attempted to contact');
      await popup.locator('#questions').getByRole('button', { name: 'Yes', exact: true }).dispatchEvent('click');
      await expect(popup.locator('#questions legend')).toHaveCount(0);
      await expect(portal.locator('#submit')).toBeEnabled();
      expect(await portal.evaluate(() => (window as unknown as { submissions: number }).submissions)).toBe(0);
      await expect(portal.locator('input:not([type=checkbox])')).toHaveCount(6); // 3 values + 3 hidden question values
      for (const input of await portal.locator('input:not([type=checkbox]):not([type=hidden])').all())
        await expect(input).not.toHaveValue('');
    } finally { await context.close(); }
  });
}

test('progressive helper rejects unapproved values, stale questions and ambiguous controls', async ({ page }) => {
  await page.goto('/mock-sct.html?dynamic=1');
  await page.locator('input[type=checkbox]').first().check();
  await expect(page.locator('#cAmount')).toBeVisible();
  const call = (action: string, payload: object = {}) => page.evaluate(
    ({ fn, action, payload }) => (0, eval)(`(${fn})`)(action, payload),
    { fn: assistProgress.toString(), action, payload },
  );
  let scan = await call('scan');
  const expected = Object.fromEntries(scan.fields.map((f: {key: string; signature: string}) => [f.key, f.signature]));
  await call('fill', { fields: { amount: { value: '25000', review: 'unreviewed' } }, expected });
  await expect(page.locator('#cAmount')).toHaveValue('');
  await page.locator('#cAmount').fill('1000');
  await expect(page.locator('#questions1Row button')).toHaveCount(2);
  scan = await call('scan');
  const question = scan.questions[0];
  await page.locator('#questions1Row .col-sm-9 .form-group').evaluate((el) => { el.firstChild!.textContent = 'A different question?'; });
  await expect(call('answer', { ...question, answer: 'Yes' })).rejects.toThrow('question changed');
  await page.locator('#cAmount').evaluate((el) => { el.after(el.cloneNode(true)); });
  scan = await call('scan');
  expect(scan.fields.find((f: {key: string}) => f.key === 'amount').reason).toContain('Ambiguous');
});

test('missing JSON values can be supplied explicitly and the Yes branch is followed', async ({ baseURL }) => {
  test.skip(test.info().project.name !== 'desktop', 'Desktop extension');
  const { context, id } = await loadExtension('cjts-prefiling', true);
  try {
    const portal = await context.newPage();
    await portal.goto(`${baseURL}/mock-sct.html?dynamic=1`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await portal.bringToFront();
    await popup.locator('#package').setInputFiles({ name: 'approved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 2, generatedAt: new Date().toISOString(), userReviewed: true,
      fields: { claimType: { value: 'Sale of goods', review: 'approved', provenance: 'user' } },
      assessment: { sctOptions: [{ groupId: 'goods', label: 'Defective Goods' }] },
    })) });
    await popup.getByLabel('Date of Cause of Action', { exact: true }).fill('2026-03-12');
    await popup.getByLabel('Claim Amount', { exact: true }).fill('1450');
    await popup.locator('#fill-progress').dispatchEvent('click');
    await expect(portal.locator('[name=d2]')).toHaveValue('12/03/2026');
    await expect(portal.locator('#cAmount')).toHaveValue('1450');
    await expect(popup.locator('#questions legend')).toContainText('proposed resolution');
    await popup.locator('#questions').getByRole('button', { name: 'Yes', exact: true }).dispatchEvent('click');
    await expect(popup.locator('#questions legend')).toContainText('recorded in writing');
    await popup.locator('#questions').getByRole('button', { name: 'No', exact: true }).dispatchEvent('click');
    await expect(portal.locator('#submit')).toBeEnabled();
    await popup.locator('#clear').click();
    await expect(popup.locator('#progress-fields input')).toHaveCount(0);
    await expect(popup.locator('#questions legend')).toHaveCount(0);
    await expect(portal.locator('#cAmount')).toHaveValue('1450');
    expect(await portal.evaluate(() => (window as unknown as { submissions: number }).submissions)).toBe(0);
  } finally { await context.close(); }
});

test('progressive fill reports invalid money and dates without overwriting existing values', async ({ page }) => {
  await page.goto('/mock-sct.html?dynamic=1');
  await page.locator('input[type=checkbox]').first().check();
  await expect(page.locator('#cAmount')).toBeVisible();
  const call = (action: string, payload: object = {}) => page.evaluate(
    ({ fn, action, payload }) => (0, eval)(`(${fn})`)(action, payload),
    { fn: assistProgress.toString(), action, payload },
  );
  const scan = await call('scan');
  const expected = Object.fromEntries(scan.fields.map((f: {key: string; signature: string}) => [f.key, f.signature]));
  const result = await call('fill', { fields: {
    amount: { value: 'SGD 1450', review: 'approved' },
    incidentDate: { value: '2026-02-30', review: 'approved' },
  }, expected });
  expect(result.results.every((row: {filled: boolean}) => !row.filled)).toBe(true);
  await expect(page.locator('#cAmount')).toHaveValue('');
  await expect(page.locator('[name=d2]')).toHaveValue('');
  await page.locator('#cAmount').fill('999');
  const occupied = await call('fill', { fields: { amount: { value: '1450', review: 'approved' } }, expected });
  expect(occupied.results[0].reason).toContain('Already contains a value');
  await expect(page.locator('#cAmount')).toHaveValue('999');
});
