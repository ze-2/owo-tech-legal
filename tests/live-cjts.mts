/** Opt-in live public-page test. Fictional values only. Never clicks Submit. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { assistAssessment } from '../cjts-prefiling/assessment-assist.mjs';
import { assistProgress } from '../cjts-prefiling/progressive-assist.mjs';
import { sctGroups } from '../cjts-prefiling/claim-type.mjs';

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const [groupId, otherName] of [
    ['goods', 'salesOthersDesc'], ['services', 'serviceOthersDesc'],
    ['property', 'damagedOthersDesc'], ['residential', 'rentalOthersDesc'],
  ]) {
    const context = await browser.newContext();
    try {
      await context.addInitScript(() => sessionStorage.setItem('TribunalType', 'SCT'));
      const page = await context.newPage();
      await page.goto('https://cjts.judiciary.gov.sg/prefiling/prefilingAssessment', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('app-sct-prefiling input[type=checkbox]').first().waitFor({ state: 'attached' });
      const call = (fn: string, ...args: unknown[]) => page.evaluate(
        ({ fn, args }) => (0, eval)(`(${fn})`)(...args), { fn, args },
      );
      const options = await call(assistAssessment.toString(), 'scan', sctGroups);
      const group = options.groups.find((g: {id: string}) => g.id === groupId);
      const row = group.options.find((o: {label: string}) => o.label === 'Others');
      const selected = await call(assistAssessment.toString(), 'apply', sctGroups, { selected: [row.id], expected: { [row.id]: row.signature } });
      assert.equal(selected.options[0].applied, true);
      await page.locator(`input[name="${otherName}"]`).waitFor({ state: 'visible' });
      let state = await call(assistProgress.toString(), 'scan');
      const fields = {
        amount: { value: '25000', review: 'approved' },
        incidentDate: { value: '2026-03-12', review: 'approved' },
        [otherName]: { value: 'Fictional test dispute', review: 'approved' },
      };
      state = await call(assistProgress.toString(), 'fill', { fields, expected: Object.fromEntries(state.fields.map((f: {key: string; signature: string}) => [f.key, f.signature])) });
      assert.equal(state.results.filter((r: {filled: boolean}) => r.filled).length, 3, JSON.stringify(state.results));
      let answered = 0;
      for (let step = 0; step < 40; step++) {
        // The questionnaire and its validation are loaded asynchronously by CJTS.
        await page.waitForTimeout(500);
        state = await call(assistProgress.toString(), 'scan');
        if (!state.questions.length) {
          if (state.readyToSubmit) break;
          continue;
        }
        const question = state.questions[0];
        const answer = question.id.startsWith('consent:') ? 'Yes' : 'No';
        await call(assistProgress.toString(), 'answer', { id: question.id, signature: question.signature, answer });
        answered++;
      }
      assert.ok(answered > 1, 'Must traverse the conditional questionnaire');
      assert.equal(state.readyToSubmit, true, 'Must reach the end without submitting');
      assert.deepEqual(state.unsupported, []);
      assert.equal(await page.locator('input[name=d2]').inputValue(), '12/03/2026');
      assert.equal(page.url(), 'https://cjts.judiciary.gov.sg/prefiling/prefilingAssessment');
      console.log(JSON.stringify({ group: groupId, filled: 3, questionsAnswered: answered, submitEnabled: true, submitted: false }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
