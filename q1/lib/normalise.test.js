import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { normalise } from './normalise.js';

const sample = JSON.parse(readFileSync(new URL('../telemetry_sample.json', import.meta.url), 'utf8'));

const feed = (...speeds) =>
  speeds.map((speed, i) => ({ timestamp: 1_000_000 + i * 1000, speed, battery: 70, motorTemp: 60 }));

// The tolerance sizes itself from recent behaviour, so a rejection needs a few
// seconds of ordinary driving in front of it.
const CRUISE = [80, 79.4, 78.9, 78.1, 77.6, 77.0];
const cruising = (...speeds) => normalise(feed(...CRUISE, ...speeds)).slice(CRUISE.length);
const statuses = (rows) => rows.map((row) => row.quality.speed);
const at = (...pairs) => normalise(pairs.map(([timestamp, speed]) => ({ timestamp, speed })));

describe('parsing', () => {
  it('recovers a value sent with its own unit', () => {
    const [row] = normalise([{ timestamp: 0, battery: '72.6%', motorTemp: '72C', speed: '68.4' }]);
    expect(row).toMatchObject({ battery: 72.6, motorTemp: 72, speed: 68.4 });
    expect(row.quality).toMatchObject({ battery: 'ok', motorTemp: 'ok', speed: 'ok' });
  });

  it('accepts °C as well as C for temperature', () => {
    expect(normalise([{ timestamp: 0, motorTemp: '72 °C' }])[0].motorTemp).toBe(72);
  });

  it('rejects a unit belonging to another field', () => {
    const [row] = normalise([{ timestamp: 0, speed: '72C', battery: '72C', motorTemp: '72%' }]);
    expect(row).toMatchObject({ speed: null, battery: null, motorTemp: null });
  });

  it('rejects anything that is not cleanly a number', () => {
    const [row] = normalise([{ timestamp: 0, speed: 'NaN', battery: '72.6broken', motorTemp: NaN }]);
    expect(row).toMatchObject({ speed: null, battery: null, motorTemp: null });
  });

  it('drops an entry with no usable timestamp', () => {
    expect(normalise([{ timestamp: 'NaN', speed: 70 }, { timestamp: 0, speed: 70 }])).toHaveLength(1);
  });
});

describe('speed', () => {
  it('leaves believable readings alone', () => {
    const rows = normalise(feed(80, 79, 78));
    expect(rows.map((row) => row.speed)).toEqual([80, 79, 78]);
    expect(statuses(rows)).toEqual(['ok', 'ok', 'ok']);
  });

  it('carries the trend forward through a missing reading', () => {
    const rows = normalise(feed(80, 79, null, 77));
    expect(rows[2].speed).toBeCloseTo(78, 1);
    expect(statuses(rows)).toEqual(['ok', 'ok', 'estimated', 'ok']);
  });

  it('keeps ageing the estimate across consecutive missing readings', () => {
    const rows = normalise(feed(76, 75, null, null, null));
    expect(rows.map((row) => row.speed)).toEqual([76, 75, 74, 73, 72]);
    expect(statuses(rows).slice(2)).toEqual(['estimated', 'estimated', 'estimated']);
  });

  it('ages the estimate by the real interval, not the sample count', () => {
    const rows = at([0, 76], [1000, 75], [3000, null]);
    expect(rows[2].speed).toBeCloseTo(73, 5);
  });

  it('measures the rate over the whole gap when a reading returns', () => {
    // 79 -> 77 across 2s is -1 km/h/s, so the next sample is predicted at 76.
    const rows = normalise(feed(80, 79, null, 77, null));
    expect(rows[4].speed).toBeCloseTo(76, 5);
  });

  it('doubts a spike instead of drawing 300 km/h', () => {
    const [spike, after] = cruising(300, 76.5);
    expect(spike.speed).toBeLessThan(80);
    expect(statuses([spike, after])).toEqual(['estimated', 'ok']);
  });

  it('doubts a one sample dropout', () => {
    const [dropout, after] = cruising(40, 76.4);
    expect(dropout.speed).toBeGreaterThan(70);
    expect(statuses([dropout, after])).toEqual(['estimated', 'ok']);
  });

  it('sizes the tolerance from the stream rather than a fixed limit', () => {
    const calm = normalise(feed(80, 79.8, 79.6, 79.4, 79.2, 73));
    const lively = normalise(feed(80, 76, 81, 74, 80, 74));
    expect(calm.at(-1).quality.speed).toBe('estimated');
    expect(lively.at(-1).quality.speed).toBe('ok');
  });

  it('expires an estimate, then picks up again', () => {
    const rows = normalise(feed(80, 79, null, null, null, null, 60));
    expect(statuses(rows)).toEqual([
      'ok',
      'ok',
      'estimated',
      'estimated',
      'estimated',
      'unavailable',
      'ok',
    ]);
    expect(rows[5].speed).toBeNull();
  });

  it('starts afresh instead of extrapolating across a long gap', () => {
    const warm = [[0, 80], [1000, 79.4], [2000, 78.9]];
    expect(at(...warm, [30_000, null]).at(-1).quality.speed).toBe('unavailable');
    expect(at(...warm, [30_000, 20]).at(-1)).toMatchObject({ speed: 20, quality: { speed: 'ok' } });
  });

  it('holds an estimate to the expiry horizon exactly, then drops it', () => {
    const warm = [[0, 80], [1000, 79.4], [2000, 78.9], [3000, 78.1]];
    // 1.5 s then 1.5 s lands on the three second horizon; 1.6 s steps past it.
    expect(at(...warm, [4500, null], [6000, null]).at(-1).quality.speed).toBe('estimated');
    expect(at(...warm, [4500, null], [6100, null]).at(-1).quality.speed).toBe('unavailable');
  });
});

describe('the sanity range bounds the estimate, not just the reading', () => {
  it('will not extrapolate below zero as the car comes to a stop', () => {
    const braking = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2].map((speed, i) => [i * 1000, speed]);
    const rows = at(...braking, [10_000, null], [11_000, null]);
    // Zero is a speed a car can genuinely reach, so the first estimate stands.
    expect(rows.at(-2)).toMatchObject({ speed: 0, quality: { speed: 'estimated' } });
    expect(rows.at(-1)).toMatchObject({ speed: null, quality: { speed: 'unavailable' } });
  });

  it('will not extrapolate above the ceiling, and re-acquires afterwards', () => {
    const rows = at([0, 0], [1000, 150], [2000, null], [3000, 140]);
    expect(rows[2]).toMatchObject({ speed: null, quality: { speed: 'unavailable' } });
    expect(rows[3]).toMatchObject({ speed: 140, quality: { speed: 'ok' } });
  });
});

describe('suspicious readings', () => {
  it('accepts hard braking once a second reading backs it up', () => {
    const rows = cruising(40, 38, 35, 30);
    expect(statuses(rows)).toEqual(['estimated', 'recovered', 'ok', 'ok']);
    expect(rows[1].speed).toBe(38);
  });

  it('accepts hard acceleration the same way', () => {
    const rows = cruising(110, 113, 116);
    expect(statuses(rows)).toEqual(['estimated', 'recovered', 'ok']);
    expect(rows[1].speed).toBe(113);
  });

  it('measures the rate from the confirmed level, not the stale one', () => {
    // 40 -> 38 is -2 km/h/s, so the sample after the confirmation predicts 36.
    const rows = cruising(40, 38, null);
    expect(rows[2].speed).toBeCloseTo(36, 5);
  });

  it('widens the corroboration window with the real interval, not the sample count', () => {
    // A candidate is always exactly one interval old, so the window it is judged
    // over is dt. Cruising here sizes that at 3.6 km/h per second.
    const cruise = [[0, 80], [1000, 79.4], [2000, 78.9], [3000, 78.1], [4000, 77.6], [5000, 77.0]];
    expect(at(...cruise, [6000, 40], [7000, 35]).at(-1).quality.speed).toBe('estimated');
    expect(at(...cruise, [6000, 40], [8000, 35]).at(-1)).toMatchObject({
      speed: 35,
      quality: { speed: 'recovered' },
    });
  });

  it('forgets a candidate that the next reading does not support', () => {
    const rows = cruising(40, 300, 76.2);
    expect(statuses(rows)).toEqual(['estimated', 'estimated', 'ok']);
  });

  it('forgets a candidate when the next reading is missing', () => {
    const rows = cruising(40, null, 40);
    expect(statuses(rows)).toEqual(['estimated', 'estimated', 'estimated']);
  });

  it('does not let a repeated corrupt string become a level', () => {
    const rows = cruising('NaN', 'NaN', 'NaN', 'NaN');
    expect(statuses(rows)).toEqual(['estimated', 'estimated', 'estimated', 'unavailable']);
  });

  it('discards a sensor stuck above the sanity ceiling rather than letting it confirm itself', () => {
    expect(statuses(cruising(300, 300, 300, 300))).toEqual([
      'estimated',
      'estimated',
      'estimated',
      'unavailable',
    ]);
  });

  it('does not carry a candidate across an expired estimate', () => {
    const rows = at([0, 80], [1000, 79.4], [2000, 78.9], [3000, 78.1], [4000, 77.6], [30_000, 20], [31_000, 19.4]);
    expect(rows.at(-2)).toMatchObject({ speed: 20, quality: { speed: 'ok' } });
    expect(rows.at(-1).quality.speed).toBe('ok');
  });

  it('accepts a stuck-at-zero sensor: known gap, unfixable from speed alone', () => {
    expect(statuses(cruising(0, 0))).toEqual(['estimated', 'recovered']);
  });
});

describe('battery and motor temperature', () => {
  it('holds the last good value across a dropout', () => {
    const rows = normalise([
      { timestamp: 0, battery: 72.4 },
      { timestamp: 1000, battery: null },
    ]);
    expect(rows[1]).toMatchObject({ battery: 72.4 });
    expect(rows[1].quality.battery).toBe('estimated');
  });

  it('reports unavailable when the very first reading is unusable', () => {
    const [row] = normalise([{ timestamp: 0, battery: null, motorTemp: 'hot' }]);
    expect(row).toMatchObject({ battery: null, motorTemp: null });
    expect(row.quality).toMatchObject({ battery: 'unavailable', motorTemp: 'unavailable' });
  });

  it('drops temperature sooner than battery, since a stale temp hides an overheat', () => {
    const rows = normalise(
      [0, 1, 2, 3].map((i) => ({
        timestamp: i * 1000,
        battery: i === 0 ? 70 : null,
        motorTemp: i === 0 ? 88 : null,
      })),
    );
    expect(rows[3].quality.motorTemp).toBe('unavailable');
    expect(rows[3].quality.battery).toBe('estimated');
  });

  it('expires on elapsed time, not on sample count', () => {
    const rows = normalise([
      { timestamp: 0, motorTemp: 88 },
      { timestamp: 5000, motorTemp: null },
    ]);
    expect(rows[1].quality.motorTemp).toBe('unavailable');
  });

  it('recovers as soon as a good reading returns', () => {
    const rows = normalise([
      { timestamp: 0, motorTemp: 88 },
      { timestamp: 5000, motorTemp: null },
      { timestamp: 6000, motorTemp: 91 },
    ]);
    expect(rows[2]).toMatchObject({ motorTemp: 91 });
    expect(rows[2].quality.motorTemp).toBe('ok');
  });

  it('will not report a battery percentage outside 0-100', () => {
    expect(normalise([{ timestamp: 0, battery: 140 }])[0].battery).toBeNull();
  });

  it('treats zero as a reading, not as missing', () => {
    const [row] = normalise([{ timestamp: 0, battery: 0, speed: 0, motorTemp: 0 }]);
    expect(row).toMatchObject({ battery: 0, speed: 0, motorTemp: 0 });
    expect(row.quality).toMatchObject({ battery: 'ok', speed: 'ok', motorTemp: 'ok' });
  });
});

describe('gps', () => {
  it('never invents a fix', () => {
    const rows = normalise([
      { timestamp: 0, gps: { lat: -33.917, lng: 151.231 } },
      { timestamp: 1000, gps: null },
    ]);
    expect(rows[1].gps).toBeNull();
    expect(rows[1].quality.gps).toBe('unavailable');
  });

  it('discards a fix that is off the planet', () => {
    expect(normalise([{ timestamp: 0, gps: { lat: 950, lng: 151 } }])[0].gps).toBeNull();
  });

  it('discards coordinates carrying a unit suffix', () => {
    expect(normalise([{ timestamp: 0, gps: { lat: '33C', lng: '151%' } }])[0].gps).toBeNull();
  });
});

describe('the supplied sample', () => {
  const rows = normalise(sample);

  it('flags the damaged readings and nothing else', () => {
    expect(rows).toHaveLength(sample.length);

    const flagged = rows
      .map((row, i) => [i, Object.values(row.quality)])
      .filter(([, quality]) => quality.some((status) => status !== 'ok'))
      .map(([i]) => i);

    // 7 and 16 missing, 12 and 19 missing speed, 14 dropout, 17 no fix, 21 spike.
    expect(flagged).toEqual([7, 12, 14, 16, 17, 19, 21]);
  });

  it('takes a value recovered from a corrupted string as real', () => {
    expect(rows[10]).toMatchObject({ battery: 72.6 });
    expect(rows[10].quality.battery).toBe('ok');
    expect(rows[15]).toMatchObject({ motorTemp: 72 });
    expect(rows[15].quality.motorTemp).toBe('ok');
  });

  it('never passes on the two readings that were plainly wrong', () => {
    const speeds = rows.map((row) => row.speed);
    expect(speeds).not.toContain(300);
    expect(speeds).not.toContain(40);
  });
});
