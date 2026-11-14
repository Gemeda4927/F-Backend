import { describe, expect, it } from 'vitest';
import { effectiveLesson, lessonProblems } from './curriculum.js';

const base = {
  title: 'Intro',
  kind: 'TEXT',
  preview: false,
  practice: false,
  content: 'Hello there, this is the first topic.',
  quiz: null,
  storage_path: null,
  draft: null,
};

describe('studio curriculum helpers', () => {
  it('overlays pending draft fields on a published topic', () => {
    const view = effectiveLesson({ ...base, draft: { title: 'Intro v2', kind: 'VIDEO' } });
    expect(view.title).toBe('Intro v2');
    expect(view.kind).toBe('VIDEO');
    expect(view.content).toBe(base.content);
    expect(effectiveLesson(base)).toBe(base);
  });
  it('flags media topics without files and incomplete quizzes', () => {
    expect(lessonProblems({ ...base, kind: 'VIDEO' }).map((p) => p.code)).toEqual(['MISSING_FILE']);
    expect(lessonProblems({ ...base, kind: 'PDF', storage_path: 'x.pdf' })).toEqual([]);
    expect(lessonProblems({ ...base, kind: 'QUIZ', quiz: [] })[0].code).toBe('EMPTY_QUIZ');
    expect(
      lessonProblems({
        ...base,
        kind: 'QUIZ',
        quiz: [{ question: 'Pick one', options: ['a', ''], correctIndex: 0 }],
      })[0].code,
    ).toBe('INVALID_QUIZ');
    expect(
      lessonProblems({
        ...base,
        kind: 'QUIZ',
        quiz: [{ question: 'Pick one', options: ['a', 'b'], correctIndex: 1 }],
      }),
    ).toEqual([]);
  });
});
