import { COMPONENTS } from './validate.js';

// Recomputed on every request rather than maintained as running aggregates. The store is
// small, and a second source of truth is one more thing that can drift out of step with it.
export function summarise(records) {
  const components = {};
  const sums = {};
  for (const name of COMPONENTS) {
    components[name] = { min: null, max: null, avg: null, count: 0 };
    sums[name] = 0;
  }

  let latest = null;

  for (const record of records) {
    const stats = components[record.component];
    stats.count += 1;
    stats.min = stats.min === null ? record.value : Math.min(stats.min, record.value);
    stats.max = stats.max === null ? record.value : Math.max(stats.max, record.value);
    sums[record.component] += record.value;

    // Greatest timestamp, not most recently uploaded: a late batch of older readings must not
    // displace a newer one. Strictly greater, so the earliest-stored record wins a tie —
    // components may legitimately share a timestamp, and this has to be deterministic.
    if (latest === null || record.timestamp > latest.timestamp) latest = record;
  }

  for (const name of COMPONENTS) {
    // Left unrounded. How many decimals an engineer wants to read is a presentation concern,
    // and rounding here would discard information the caller cannot get back.
    if (components[name].count > 0) components[name].avg = sums[name] / components[name].count;
  }

  // Every component appears whether or not it has data, with null rather than 0 for its
  // statistics: 0 is a reading a sensor can genuinely produce, so it cannot also mean "none".
  return { count: records.length, components, latest };
}
