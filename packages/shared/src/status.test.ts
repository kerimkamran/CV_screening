import { describe, expect, it } from 'vitest';
import {
  CV_STATUSES,
  CV_STATUS_ACTION,
  CV_STATUS_LABEL,
  countByStatus,
  cvStatus,
  uploadStatus,
} from './status.js';

describe('cvStatus (S2-BE1)', () => {
  it('maps every stored state to exactly one status', () => {
    expect(cvStatus({ erased: true, screening: { state: 'completed' } })).toBe('erased');
    expect(cvStatus({ screening: null })).toBe('not_analyzed');
    expect(cvStatus({})).toBe('not_analyzed');
    expect(cvStatus({ screening: { state: 'queued' } })).toBe('analyzing');
    expect(cvStatus({ screening: { state: 'processing' } })).toBe('analyzing');
    expect(cvStatus({ screening: { state: 'queued', cancelled: true } })).toBe('stopped');
    expect(cvStatus({ screening: { state: 'failed' } })).toBe('failed');
    expect(cvStatus({ screening: { state: 'manual' } })).toBe('unreadable');
    expect(cvStatus({ screening: { state: 'completed', band: 'needs_review' } })).toBe(
      'needs_look',
    );
    expect(
      cvStatus({ screening: { state: 'completed', band: 'strong_match', scored: true } }),
    ).toBe('analyzed');
    expect(cvStatus({ screening: { state: 'completed', scored: false } })).toBe('needs_look');
  });

  it('a missing screening is never "analyzing" (no phantom queued)', () => {
    expect(cvStatus({ screening: undefined })).not.toBe('analyzing');
  });

  it('every status has a label and an action entry', () => {
    for (const s of CV_STATUSES) {
      expect(CV_STATUS_LABEL[s]).toBeTruthy();
      expect(s in CV_STATUS_ACTION).toBe(true);
    }
  });

  it('maps upload outcomes', () => {
    expect(uploadStatus(null)).toBe('not_sent');
    expect(uploadStatus('rejected', 'wrong_type')).toBe('rejected');
    expect(uploadStatus('duplicate')).toBe('duplicate');
    expect(uploadStatus('skipped', 'vacancy_full')).toBe('vacancy_full');
    expect(uploadStatus('unreadable')).toBe('unreadable');
    expect(uploadStatus('queued')).toBe('analyzing');
  });

  it('counts each document once', () => {
    const c = countByStatus(['analyzed', 'analyzed', 'failed', 'erased']);
    expect(c.analyzed).toBe(2);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(4);
  });
});
