import { describe, it, expect } from 'vitest';
import { validateEntry } from './validate.js';

const valid = { timestamp: 1755500000000, component: 'battery', value: 72.4 };

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(valid)).toEqual({ record: valid });
  });

  it('accepts a value of 0', () => {
    // 0 km/h or 0 % is a real reading. A falsy check here would reject it.
    expect(validateEntry({ ...valid, value: 0 })).toEqual({ record: { ...valid, value: 0 } });
  });

  it('strips unknown fields from the stored record', () => {
    const { record } = validateEntry({ ...valid, unit: 'percent', sequence: 12 });
    expect(Object.keys(record).sort()).toEqual(['component', 'timestamp', 'value']);
  });

  it('reports every bad field in one entry, without cascading on a missing one', () => {
    const { details } = validateEntry({ component: 'flux', value: '72.4' });
    expect(details).toEqual([
      { field: 'timestamp', code: 'MISSING_FIELD', message: expect.any(String) },
      { field: 'component', code: 'INVALID_COMPONENT', message: expect.any(String) },
      { field: 'value', code: 'INVALID_TYPE', message: expect.any(String) },
    ]);
  });

  it('rejects numeric strings rather than coercing them', () => {
    expect(validateEntry({ ...valid, value: '72.4' }).details).toHaveLength(1);
    expect(validateEntry({ ...valid, timestamp: '1755500000000' }).details).toHaveLength(1);
  });

  it('rejects NaN and Infinity values', () => {
    expect(validateEntry({ ...valid, value: NaN }).details).toHaveLength(1);
    expect(validateEntry({ ...valid, value: Infinity }).details).toHaveLength(1);
  });

  it('rejects non-integer and negative timestamps', () => {
    expect(validateEntry({ ...valid, timestamp: 1755500000000.5 }).details).toHaveLength(1);
    expect(validateEntry({ ...valid, timestamp: -1 }).details).toHaveLength(1);
  });

  it('accepts timestamp 0 as a valid epoch millisecond', () => {
    expect(validateEntry({ ...valid, timestamp: 0 }).record.timestamp).toBe(0);
  });

  it('rejects components differing only by case or whitespace', () => {
    for (const component of ['Battery', 'BATTERY', 'battery ', ' battery']) {
      expect(validateEntry({ ...valid, component }).details[0].code).toBe('INVALID_COMPONENT');
    }
  });

  it('rejects null values as missing rather than absent', () => {
    expect(validateEntry({ ...valid, value: null }).details[0].code).toBe('INVALID_TYPE');
  });

  it('rejects entries that are not plain objects', () => {
    for (const entry of [null, 'battery', 42, [valid]]) {
      expect(validateEntry(entry).details[0].code).toBe('INVALID_TYPE');
    }
  });
});
