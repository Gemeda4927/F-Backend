import { describe, expect, it } from 'vitest';
import { conflictMessage } from './database.filter.js';
describe('friendly database conflicts', () => {
  it('explains duplicate course order for array and driver constraint metadata', () => {
    for (const meta of [
      { modelName: 'Lesson', target: ['course_id', 'position'] },
      {
        driverAdapterError: {
          cause: { constraint: { index: 'lessons_course_id_position_key' } },
        },
      },
    ])
      expect(conflictMessage('P2002', meta)).toContain('content order');
  });
  it('gives account and related-record guidance without revealing database details', () => {
    expect(conflictMessage('P2002', { target: ['email'] })).toContain(
      'Sign in',
    );
    expect(conflictMessage('P2003')).toContain('Refresh');
    const message = conflictMessage('P2002', {
      detail: 'SQL with secret values',
      target: ['unknown'],
    });
    expect(message).not.toContain('SQL');
    expect(message).not.toContain('secret');
    expect(message).toContain('different details');
  });
});
