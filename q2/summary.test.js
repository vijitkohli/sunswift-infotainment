import { describe, it, expect } from 'vitest';
import { summarise } from './summary.js';

const event = (timestamp, component, value) => ({ timestamp, component, value });

describe('summarise', () => {
  it('returns the full component shape with null statistics for an empty store', () => {
    expect(summarise([])).toEqual({
      count: 0,
      components: {
        battery: { min: null, max: null, avg: null, count: 0 },
        motor: { min: null, max: null, avg: null, count: 0 },
        gps: { min: null, max: null, avg: null, count: 0 },
      },
      latest: null,
    });
  });

  it('computes min, max, avg and count per component', () => {
    const { count, components } = summarise([
      event(1000, 'battery', 70),
      event(2000, 'battery', 76),
      event(3000, 'battery', 73),
      event(1000, 'motor', 61),
    ]);
    expect(count).toBe(4);
    expect(components.battery).toEqual({ min: 70, max: 76, avg: 73, count: 3 });
    expect(components.motor).toEqual({ min: 61, max: 61, avg: 61, count: 1 });
  });

  it('leaves averages unrounded', () => {
    const { components } = summarise([
      event(1000, 'gps', 0.0123),
      event(2000, 'gps', 0.0456),
      event(3000, 'gps', 0.129),
    ]);
    expect(components.gps.avg).toBe((0.0123 + 0.0456 + 0.129) / 3);
  });

  it('keeps components with no events in the response', () => {
    const { components } = summarise([event(1000, 'battery', 70)]);
    expect(components.gps).toEqual({ min: null, max: null, avg: null, count: 0 });
  });

  it('picks latest by greatest timestamp, not arrival order', () => {
    const { latest } = summarise([
      event(3000, 'battery', 70),
      event(1000, 'motor', 61),
      event(2000, 'gps', 0.02),
    ]);
    expect(latest).toEqual(event(3000, 'battery', 70));
  });

  it('breaks a timestamp tie in favour of the earliest-stored record', () => {
    const { latest } = summarise([
      event(1000, 'battery', 70),
      event(3000, 'motor', 61),
      event(3000, 'gps', 0.02),
    ]);
    expect(latest).toEqual(event(3000, 'motor', 61));
  });
});
