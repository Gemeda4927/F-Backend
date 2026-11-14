import { describe, expect, it } from 'vitest';
import { applyWordingCorrections, type Question } from './questions.js';

const bank: Question[] = [
  {
    id: 'q1',
    type: 'MCQ',
    question: 'Whcih are prime?',
    points: 6,
    difficulty: 'MEDIUM',
    explanation: 'Two and three.',
    options: [
      { id: 'a', text: '2' },
      { id: 'b', text: '3' },
      { id: 'c', text: 'for' },
    ],
    correct: ['a', 'b'],
  },
];

describe('wording corrections after attempts', () => {
  it('changes only text and reports which questions changed', () => {
    const result = applyWordingCorrections(bank, [
      { id: 'q1', question: 'Which are prime?', options: [{ id: 'c', text: '4' }] },
    ]);
    expect(result.changed).toEqual(['q1']);
    expect(result.bank[0].question).toBe('Which are prime?');
    expect(result.bank[0].options?.map((o) => o.text)).toEqual(['2', '3', '4']);
    expect(result.bank[0].correct).toEqual(['a', 'b']);
    expect(result.bank[0].points).toBe(6);
    expect(bank[0].question).toBe('Whcih are prime?');
  });
  it('rejects unknown questions and new options', () => {
    expect(() => applyWordingCorrections(bank, [{ id: 'zz', question: 'x' }])).toThrow();
    expect(() =>
      applyWordingCorrections(bank, [{ id: 'q1', options: [{ id: 'd', text: '5' }] }]),
    ).toThrow(/cannot be added/);
  });
  it('ignores grading fields even if a client sends them', () => {
    const result = applyWordingCorrections(bank, [
      { id: 'q1', points: 100, correct: ['c'] } as never,
    ]);
    expect(result.changed).toEqual([]);
    expect(result.bank[0].points).toBe(6);
    expect(result.bank[0].correct).toEqual(['a', 'b']);
  });
});
