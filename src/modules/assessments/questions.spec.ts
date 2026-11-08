import { describe, expect, it } from 'vitest';
import {
  validateBank,
  validateResponses,
  gradeBank,
  publicQuestion,
  shuffled,
  type Question,
} from './questions.js';
const base = {
  id: 'q1',
  type: 'MCQ',
  question: 'Which are prime?',
  points: 6,
  difficulty: 'MEDIUM',
  explanation: 'Two and three have exactly two divisors.',
  options: [
    { id: 'a', text: '2' },
    { id: 'b', text: '3' },
    { id: 'c', text: '4' },
  ],
  correct: ['a', 'b'],
} satisfies Question;
describe('typed exam grading and answer privacy', () => {
  it('requires exact selected sets for multiple choice by default', () => {
    expect(gradeBank([base], { q1: ['b', 'a'] })[0].earned).toBe(6);
    expect(gradeBank([base], { q1: ['a'] })[0].earned).toBe(0);
    expect(gradeBank([base], { q1: ['a', 'b', 'c'] })[0].earned).toBe(0);
  });
  it('deducts wrong options with a zero floor for configured partial credit', () => {
    expect(
      gradeBank([{ ...base, partial_credit: true }], { q1: ['a'] })[0].earned,
    ).toBe(3);
    expect(
      gradeBank([{ ...base, partial_credit: true }], { q1: ['a', 'c'] })[0]
        .earned,
    ).toBe(0);
    expect(
      gradeBank([{ ...base, partial_credit: true }], { q1: ['c'] })[0].earned,
    ).toBe(0);
  });
  it('normalizes Unicode, whitespace and case; applies numeric tolerance only when configured', () => {
    const q: Question = {
      ...base,
      type: 'BLANK',
      accepted: [['high-level'], ['10']],
      partial_credit: true,
      numeric_tolerance: 0.1,
    };
    expect(gradeBank([q], { q1: [' HIGH-LEVEL ', '10.05'] })[0].earned).toBe(6);
    expect(
      gradeBank([{ ...q, case_sensitive: true }], {
        q1: ['HIGH-LEVEL', '10.05'],
      })[0].earned,
    ).toBe(3);
    expect(
      gradeBank([{ ...q, numeric_tolerance: undefined }], {
        q1: ['high-level', '10.05'],
      })[0].earned,
    ).toBe(3);
    expect(gradeBank([q], { q1: ['', ''] })[0].earned).toBe(0);
  });
  it('grades boolean false without treating it as an unanswered response', () => {
    const q: Question = { ...base, type: 'BOOLEAN', correct_boolean: false };
    expect(gradeBank([q], { q1: false })[0].earned).toBe(6);
    expect(gradeBank([q], {})[0].earned).toBe(0);
  });
  it('leaves short answers and code pending manual review', () => {
    const short: Question = {
      ...base,
      type: 'SHORT',
      model_answer: 'A model answer',
    };
    const code: Question = {
      ...base,
      id: 'code',
      type: 'CODE',
      model_answer: 'return 42',
    };
    expect(
      gradeBank([short, code], {
        q1: 'My response',
        code: 'untrusted code',
      }).every((g) => g.earned === null),
    ).toBe(true);
    expect(
      gradeBank([{ ...short, grading_mode: 'EXACT', accepted: [['yes']] }], {
        q1: 'YES',
      })[0].earned,
    ).toBe(6);
  });
  it('grades image questions through the selected response format', () => {
    expect(
      gradeBank(
        [
          {
            ...base,
            type: 'IMAGE',
            response_type: 'BOOLEAN',
            correct_boolean: true,
          },
        ],
        { q1: true },
      )[0].earned,
    ).toBe(6);
  });
  it('builds student data with an explicit allow-list, omitting all answer keys', () => {
    const safe = publicQuestion({
      ...base,
      model_answer: 'secret',
      accepted: [['secret']],
      correct_boolean: true,
      explanation: 'private',
    });
    for (const key of [
      'correct',
      'accepted',
      'correct_boolean',
      'model_answer',
      'explanation',
      'grading_mode',
    ])
      expect(safe).not.toHaveProperty(key);
    expect(safe.multiple).toBe(true);
    expect(safe.options?.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('rejects duplicate IDs, foreign choices, invalid marks and unknown config fields', () => {
    expect(() => validateBank([base, base])).toThrow();
    expect(() => validateBank([{ ...base, correct: ['other'] }])).toThrow();
    expect(() => validateBank([{ ...base, points: -1 }])).toThrow();
    expect(() =>
      validateBank([
        { ...base, hidden_tests: ['do not accept unconfigured execution'] },
      ]),
    ).toThrow();
    expect(() =>
      validateResponses([base], { q1: ['not-an-option'] }),
    ).toThrow();
    expect(() => validateResponses([base], { unknown: 'text' })).toThrow();
  });
  it('allows incomplete drafts but requires keys and explanations before publication', () => {
    expect(validateBank([], false)).toEqual([]);
    expect(
      validateBank(
        [{ ...base, question: '', explanation: '', correct: [] }],
        false,
      ),
    ).toHaveLength(1);
    expect(() => validateBank([])).toThrow();
    expect(() => validateBank([{ ...base, explanation: '' }])).toThrow();
  });
  it('strips type-inapplicable data instead of leaking it through public fields', () => {
    const q = {
      ...base,
      type: 'SHORT' as const,
      model_answer: 'Private',
      samples: [{ input: 'private input', output: 'private output' }],
    };
    const canonical = validateBank([q])[0];
    expect(canonical).not.toHaveProperty('options');
    expect(canonical).not.toHaveProperty('correct');
    expect(canonical).not.toHaveProperty('samples');
    expect(publicQuestion(q).options).toBeUndefined();
    expect(publicQuestion(q).samples).toBeUndefined();
  });
  it('keeps originals intact when randomizing', () => {
    const ids = ['a', 'b', 'c'];
    expect([...shuffled(ids)].sort()).toEqual(ids);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
