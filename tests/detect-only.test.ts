import { expect, test } from 'vitest';
import { detect } from '../src/engine/rules';

test('flags AI vocabulary', () => {
  const tells = detect('We delve into the intricate interplay.');
  expect(tells.filter(t => t.ruleId === 'ai-vocab')).toHaveLength(3);
});

test('flags negative parallelism', () => {
  const tells = detect('It is not just fast but also cheap.');
  expect(tells.some(t => t.ruleId === 'negative-parallelism')).toBe(true);
});

test('flags rule-of-three lists', () => {
  const tells = detect('We ship talks, panels, and demos. We value speed, quality, and trust.');
  expect(tells.filter(t => t.ruleId === 'rule-of-three')).toHaveLength(2);
});

test('flags title-case markdown headings', () => {
  const tells = detect('## Strategic Negotiations And Global Partnerships\nBody text.');
  expect(tells.some(t => t.ruleId === 'title-case-heading')).toBe(true);
});

test('flags bolded inline-header list items', () => {
  const tells = detect('- **Performance:** faster now');
  expect(tells.some(t => t.ruleId === 'bold-header-list')).toBe(true);
});

test('does not flag plain prose', () => {
  expect(detect('The report is ready and the team approved it.')).toHaveLength(0);
});
