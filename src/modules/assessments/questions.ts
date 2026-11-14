import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'node:crypto';

export type QuestionType =
  'MCQ' | 'BLANK' | 'BOOLEAN' | 'SHORT' | 'CODE' | 'IMAGE';
export type Question = {
  id: string;
  type: QuestionType;
  question: string;
  points: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  explanation: string;
  hint?: string;
  image_id?: string;
  image_alt?: string;
  response_type?: 'MCQ' | 'BLANK' | 'BOOLEAN' | 'SHORT';
  options?: { id: string; text: string; image_id?: string }[];
  correct?: string[];
  partial_credit?: boolean;
  accepted?: string[][];
  case_sensitive?: boolean;
  numeric_tolerance?: number;
  correct_boolean?: boolean;
  grading_mode?: 'MANUAL' | 'EXACT';
  model_answer?: string;
  language?: string;
  starter_code?: string;
  samples?: { input: string; output: string }[];
  time_limit_ms?: number;
  memory_limit_mb?: number;
};
export type Responses = Record<string, string | string[] | boolean>;
export type Grade = {
  id: string;
  points: number;
  earned: number | null;
  feedback?: string;
};
const types = ['MCQ', 'BLANK', 'BOOLEAN', 'SHORT', 'CODE', 'IMAGE'];
const languages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'sql'];
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  throw new BadRequestException(message);
}
function text(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (!required || !!value.trim())
  );
}
export function format(q: Question) {
  return q.type === 'IMAGE' ? q.response_type! : q.type;
}
/** Validate a bounded JSON structure; draft questions may omit answer keys and text. */
export function validateBank(value: unknown, published = true): Question[] {
  if (!Array.isArray(value) || value.length > 200)
    fail('Use at most 200 questions');
  if (published && !value.length)
    fail('Add at least one question before publishing');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      fail('Invalid question');
    const q = item as Question;
    const allowed = [
      'id',
      'type',
      'question',
      'points',
      'difficulty',
      'explanation',
      'hint',
      'image_id',
      'image_alt',
      'response_type',
      'options',
      'correct',
      'partial_credit',
      'accepted',
      'case_sensitive',
      'numeric_tolerance',
      'correct_boolean',
      'grading_mode',
      'model_answer',
      'language',
      'starter_code',
      'samples',
      'time_limit_ms',
      'memory_limit_mb',
    ];
    if (Object.keys(q).some((k) => !allowed.includes(k)))
      fail('Unknown question field');
    if (!text(q.id, 80, true) || !idPattern.test(q.id) || ids.has(q.id))
      fail('Use unique question IDs');
    ids.add(q.id);
    if (
      !types.includes(q.type) ||
      !['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty)
    )
      fail('Invalid question type or difficulty');
    if (
      !text(q.question, 10000, published) ||
      !text(q.explanation, 10000, published)
    )
      fail(
        'Every published question needs a statement and detailed explanation',
      );
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 1000)
      fail('Question marks must be 1-1000');
    for (const key of [
      'hint',
      'image_alt',
      'model_answer',
      'starter_code',
    ] as const)
      if (
        q[key] !== undefined &&
        !text(
          q[key],
          key === 'starter_code' ||
            (key === 'model_answer' && q.type === 'CODE')
            ? 30000
            : 10000,
        )
      )
        fail(`Invalid ${key}`);
    if (q.image_id && !uuidPattern.test(q.image_id))
      fail('Invalid question image');
    if (
      q.type === 'IMAGE' &&
      (!['MCQ', 'BLANK', 'BOOLEAN', 'SHORT'].includes(q.response_type ?? '') ||
        (published && !q.image_id))
    )
      fail('Image questions need an image and response format');
    if (published && q.image_id && !q.image_alt?.trim())
      fail('Add an accessible image description');
    for (const key of ['partial_credit', 'case_sensitive'] as const)
      if (q[key] !== undefined && typeof q[key] !== 'boolean')
        fail('Invalid matching setting');
    if (
      q.numeric_tolerance !== undefined &&
      (typeof q.numeric_tolerance !== 'number' ||
        !Number.isFinite(q.numeric_tolerance) ||
        q.numeric_tolerance < 0 ||
        q.numeric_tolerance > 1000000)
    )
      fail('Invalid numeric tolerance');
    const kind = format(q);
    if (kind === 'MCQ') {
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 20
      )
        fail('Add 2-20 options');
      const optionIds = new Set<string>();
      for (const o of q.options) {
        if (
          !o ||
          !text(o.id, 80, true) ||
          !idPattern.test(o.id) ||
          optionIds.has(o.id) ||
          !text(o.text, 2000, published && !o.image_id) ||
          (o.image_id && !uuidPattern.test(o.image_id)) ||
          Object.keys(o).some((k) => !['id', 'text', 'image_id'].includes(k))
        )
          fail('Invalid or duplicate answer option');
        optionIds.add(o.id);
      }
      if (
        !Array.isArray(q.correct) ||
        (published && !q.correct.length) ||
        new Set(q.correct).size !== q.correct.length ||
        q.correct.some((x) => !optionIds.has(x))
      )
        fail('Select valid correct options');
    }
    if (kind === 'BOOLEAN' && typeof q.correct_boolean !== 'boolean')
      fail('Select True or False');
    if (kind === 'BLANK' || (kind === 'SHORT' && q.grading_mode === 'EXACT')) {
      if (
        !Array.isArray(q.accepted) ||
        q.accepted.length < 1 ||
        q.accepted.length > (kind === 'BLANK' ? 20 : 1) ||
        q.accepted.some(
          (a) =>
            !Array.isArray(a) ||
            a.length > 20 ||
            (published && !a.length) ||
            a.some((t) => !text(t, 1000, published)),
        )
      )
        fail('Define accepted answers for each blank');
    }
    if (
      kind === 'SHORT' &&
      !['MANUAL', 'EXACT'].includes(q.grading_mode ?? 'MANUAL')
    )
      fail('Invalid short-answer grading mode');
    if (
      (kind === 'SHORT' || kind === 'CODE') &&
      published &&
      !q.model_answer?.trim()
    )
      fail('Add a model answer or reference solution');
    if (kind === 'CODE') {
      if (!languages.includes(q.language ?? ''))
        fail('Select a supported coding language');
      if (
        !Number.isInteger(q.time_limit_ms) ||
        q.time_limit_ms! < 100 ||
        q.time_limit_ms! > 30000 ||
        !Number.isInteger(q.memory_limit_mb) ||
        q.memory_limit_mb! < 16 ||
        q.memory_limit_mb! > 1024
      )
        fail('Invalid coding resource limits');
      if (
        !Array.isArray(q.samples) ||
        q.samples.length > 20 ||
        q.samples.some(
          (s) =>
            !s ||
            !text(s.input, 2000) ||
            !text(s.output, 2000) ||
            Object.keys(s).some((k) => !['input', 'output'].includes(k)),
        )
      )
        fail('Invalid public coding samples');
    }
  }
  if ((value as Question[]).reduce((sum, q) => sum + q.points, 0) > 10000)
    fail('Total exam marks cannot exceed 10000');
  return (value as Question[]).map((q) => {
    const kind = format(q);
    const common = {
      id: q.id,
      type: q.type,
      question: q.question,
      points: q.points,
      difficulty: q.difficulty,
      explanation: q.explanation,
      hint: q.hint,
      image_id: q.image_id,
      image_alt: q.image_alt,
      ...(q.type === 'IMAGE' ? { response_type: q.response_type } : {}),
    };
    if (kind === 'MCQ')
      return {
        ...common,
        options: q.options,
        correct: q.correct,
        partial_credit: q.partial_credit,
      };
    if (kind === 'BOOLEAN')
      return { ...common, correct_boolean: q.correct_boolean };
    if (kind === 'BLANK')
      return {
        ...common,
        accepted: q.accepted,
        case_sensitive: q.case_sensitive,
        numeric_tolerance: q.numeric_tolerance,
        partial_credit: q.partial_credit,
      };
    if (kind === 'SHORT')
      return {
        ...common,
        grading_mode: q.grading_mode ?? 'MANUAL',
        model_answer: q.model_answer,
        ...(q.grading_mode === 'EXACT'
          ? {
              accepted: q.accepted,
              case_sensitive: q.case_sensitive,
              numeric_tolerance: q.numeric_tolerance,
            }
          : {}),
      };
    return {
      ...common,
      model_answer: q.model_answer,
      language: q.language,
      starter_code: q.starter_code,
      samples: q.samples,
      time_limit_ms: q.time_limit_ms,
      memory_limit_mb: q.memory_limit_mb,
    };
  });
}
export function validateResponses(bank: Question[], raw: unknown): Responses {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('Responses must be a question-ID map');
  if (JSON.stringify(raw).length > 150000) fail('Responses are too large');
  const responses = raw as Responses;
  for (const [id, v] of Object.entries(responses)) {
    const q = bank.find((x) => x.id === id);
    if (!q) fail('Response refers to an unknown question');
    const kind = format(q);
    if (kind === 'BOOLEAN') {
      if (typeof v !== 'boolean' && v !== '') fail('Choose True or False');
    } else if (kind === 'MCQ') {
      if (
        !Array.isArray(v) ||
        v.length > 20 ||
        new Set(v).size !== v.length ||
        v.some((x) => !q.options?.some((o) => o.id === x))
      )
        fail('Choose valid answer options');
    } else if (kind === 'BLANK') {
      if (
        !Array.isArray(v) ||
        v.length !== q.accepted?.length ||
        v.some((x) => !text(x, 1000))
      )
        fail('Answer each blank');
    } else if (!text(v, kind === 'CODE' ? 30000 : 5000))
      fail('Invalid text response');
  }
  return responses;
}
function matches(value: string, answers: string[], q: Question) {
  const normalized = (s: string) => {
    const t = s.normalize('NFKC').trim().replace(/\s+/g, ' ');
    return q.case_sensitive ? t : t.toLowerCase();
  };
  if (!value.trim()) return false;
  return answers.some(
    (a) =>
      normalized(a) === normalized(value) ||
      (q.numeric_tolerance !== undefined &&
        a.trim() &&
        Number.isFinite(Number(a)) &&
        Number.isFinite(Number(value)) &&
        Math.abs(Number(a) - Number(value)) <= q.numeric_tolerance),
  );
}
export function gradeBank(bank: Question[], responses: Responses): Grade[] {
  return bank.map((q) => {
    const v = responses[q.id],
      kind = format(q);
    let fraction = 0;
    if ((kind === 'SHORT' && q.grading_mode !== 'EXACT') || kind === 'CODE')
      return { id: q.id, points: q.points, earned: null };
    if (kind === 'MCQ') {
      const selected = Array.isArray(v) ? v : [];
      const correct = q.correct ?? [];
      if (q.partial_credit)
        fraction = Math.max(
          0,
          (selected.filter((x) => correct.includes(x)).length -
            selected.filter((x) => !correct.includes(x)).length) /
            correct.length,
        );
      else
        fraction =
          selected.length === correct.length &&
          selected.every((x) => correct.includes(x))
            ? 1
            : 0;
    } else if (kind === 'BOOLEAN')
      fraction = typeof v === 'boolean' && v === q.correct_boolean ? 1 : 0;
    else if (kind === 'BLANK') {
      const count = q.accepted!.filter((answers, i) =>
        matches(Array.isArray(v) ? (v[i] ?? '') : '', answers, q),
      ).length;
      fraction = q.partial_credit
        ? count / q.accepted!.length
        : count === q.accepted!.length
          ? 1
          : 0;
    } else if (kind === 'SHORT')
      fraction = matches(typeof v === 'string' ? v : '', q.accepted![0], q)
        ? 1
        : 0;
    return {
      id: q.id,
      points: q.points,
      earned: Math.round(q.points * fraction * 100) / 100,
    };
  });
}
export function publicQuestion(q: Question) {
  // Explicit allow-list: never spread instructor JSON into a learner response.
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    points: q.points,
    difficulty: q.difficulty,
    hint: q.hint,
    image_id: q.image_id,
    image_alt: q.image_alt,
    response_type: q.type === 'IMAGE' ? q.response_type : undefined,
    options:
      format(q) === 'MCQ'
        ? q.options?.map((o) => ({
            id: o.id,
            text: o.text,
            image_id: o.image_id,
          }))
        : undefined,
    multiple: (q.correct?.length ?? 0) > 1,
    blank_count: format(q) === 'BLANK' ? q.accepted?.length : undefined,
    language: q.type === 'CODE' ? q.language : undefined,
    starter_code: q.type === 'CODE' ? q.starter_code : undefined,
    samples:
      q.type === 'CODE'
        ? q.samples?.map((s) => ({ input: s.input, output: s.output }))
        : undefined,
    time_limit_ms: q.type === 'CODE' ? q.time_limit_ms : undefined,
    memory_limit_mb: q.type === 'CODE' ? q.memory_limit_mb : undefined,
  };
}
export function answerReview(q: Question) {
  return {
    id: q.id,
    correct: q.correct,
    accepted: q.accepted,
    correct_boolean: q.correct_boolean,
    model_answer: q.model_answer,
    explanation: q.explanation,
  };
}
export function shuffled<T>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export type WordingCorrection = {
  id: string;
  question?: string;
  explanation?: string;
  hint?: string;
  image_alt?: string;
  options?: { id: string; text: string }[];
};
const wordingFields = ['question', 'explanation', 'hint', 'image_alt'] as const;

/**
 * Apply text-only corrections to a bank that students have already attempted.
 * Anything that affects grading (types, points, answer keys, option sets, order)
 * is left untouched, so existing attempts keep their meaning.
 */
export function applyWordingCorrections(
  bank: Question[],
  corrections: WordingCorrection[],
): { bank: Question[]; changed: string[] } {
  const byId = new Map(bank.map((q) => [q.id, { ...q }]));
  const changed = new Set<string>();
  for (const c of corrections) {
    const q = byId.get(c.id);
    if (!q) fail('A corrected question no longer exists; reload the exam');
    for (const key of wordingFields) {
      const value = c[key];
      if (value === undefined || value === q[key]) continue;
      if (!text(value, 10000)) fail(`Invalid ${key}`);
      if (key === 'hint' || key === 'image_alt') q[key] = value || undefined;
      else q[key] = value;
      changed.add(q.id);
    }
    if (c.options) {
      if (!q.options) fail('This question has no answer options to correct');
      const options = q.options.map((o) => ({ ...o }));
      for (const o of c.options) {
        const target = options.find((x) => x.id === o.id);
        if (!target)
          fail('Answer options cannot be added or removed after attempts');
        if (!text(o.text, 2000, !target.image_id)) fail('Invalid option text');
        if (target.text !== o.text) {
          target.text = o.text;
          changed.add(q.id);
        }
      }
      q.options = options;
    }
  }
  return { bank: bank.map((q) => byId.get(q.id)!), changed: [...changed] };
}
