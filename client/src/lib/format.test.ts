import { describe, expect, it } from 'vitest';
import { colorForName, initials } from './colors';
import { parseServerDate, timeAgo } from './format';

describe('parseServerDate', () => {
  it('treats zone-less timestamps as UTC', () => {
    expect(parseServerDate('2026-10-12 10:00:00').toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });
  it('keeps ISO strings with a zone untouched', () => {
    expect(parseServerDate('2026-10-12T10:00:00.000Z').toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  it('formats relative times', () => {
    expect(timeAgo('2026-10-12 11:59:30', now)).toBe('just now');
    expect(timeAgo('2026-10-12 11:30:00', now)).toBe('30m ago');
    expect(timeAgo('2026-10-12 09:00:00', now)).toBe('3h ago');
    expect(timeAgo('2026-10-09 12:00:00', now)).toBe('3d ago');
  });
});

describe('colors', () => {
  it('is stable for the same name and returns a palette color', () => {
    expect(colorForName('Ada')).toBe(colorForName('Ada'));
    expect(colorForName('Ada')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('builds initials', () => {
    expect(initials('ada lovelace byron')).toBe('AL');
    expect(initials('')).toBe('?');
  });
});
