/*
 * Telemetry values are parsed into consistent numeric fields, with invalid GPS
 * coordinates represented as null. Because the data represents a live stream,
 * speed dropouts use a short causal estimate based on recent motion rather than
 * interpolation, which would require a future sample. Unexpected speed readings
 * are initially treated as suspicious, but a following consistent reading is
 * taken as agreement and adopted as a new level. Estimates expire after a short
 * period so the UI does not continue displaying increasingly uncertain values.
 */

// No vehicle specification was supplied, so these are application-level sanity
// bounds rather than claimed vehicle limits; real limits belong in config. The
// speed ceiling matters because corroboration accepts a repeated reading, so a
// sensor stuck high would otherwise confirm itself as a new level.
const SPEED_RANGE = [0, 200];
const BATTERY_RANGE = [0, 100];
const MOTOR_TEMP_RANGE = [-20, 200];

// How far a speed reading may sit from the prediction: GATE_MULTIPLE times the
// median of the last GATE_WINDOW accepted rates, never below GATE_FLOOR km/h
// per second of sensor noise. Sized from the signal's own recent movement, so
// no acceleration limit is asserted.
const GATE_MULTIPLE = 6;
const GATE_WINDOW = 10;
const GATE_FLOOR = 2;
const GATE_MIN_SAMPLES = 3;

// Subsystems occasionally send the unit alongside the value, so each field
// accepts only its own. Stricter than parseFloat, which reads "72.6broken"
// as 72.6 and would pass corrupt data through silently.
const PLAIN = /^([+-]?\d+(?:\.\d+)?)$/;
const PERCENTAGE = /^([+-]?\d+(?:\.\d+)?)\s*%?$/;
const CELSIUS = /^([+-]?\d+(?:\.\d+)?)\s*(?:°?C)?$/i;

function parse(pattern, raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const match = pattern.exec(raw.trim());
  return match ? Number(match[1]) : null;
}

const parseNumber = (raw) => parse(PLAIN, raw);
const parseBattery = (raw) => parse(PERCENTAGE, raw);
const parseTemperature = (raw) => parse(CELSIUS, raw);

// Not estimated when missing: a guessed position is worse than no position.
function parseGps(raw) {
  if (!raw) return null;
  const lat = parseNumber(raw.lat);
  const lng = parseNumber(raw.lng);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// maxEstimateAge is in seconds and covers both jobs: it is how long a value may
// be carried forward, and how far back a reading may be judged against.
function createSpeedTracker(maxEstimateAge) {
  const [min, max] = SPEED_RANGE;
  const recentRates = []; // accepted rates of change, km/h per second
  let lastAccepted = null;
  let ratePerSecond = 0;
  let elapsedSinceAccepted = 0; // seconds; meaningful only while lastAccepted is set
  let suspiciousCandidate = null;

  // Kept across expiry: a dropout does not change how noisy the sensor is.
  const tolerance = (seconds) => {
    if (recentRates.length < GATE_MIN_SAMPLES) return Infinity;
    const typical = median(recentRates.map((rate) => Math.abs(rate)));
    return Math.max(GATE_FLOOR, GATE_MULTIPLE * typical) * seconds;
  };

  return (raw, dt) => {
    const value = parseNumber(raw);
    const usable = value !== null && value >= min && value <= max;
    const elapsed = elapsedSinceAccepted + (dt ?? 0);

    const extrapolated =
      lastAccepted !== null && elapsed <= maxEstimateAge
        ? lastAccepted + ratePerSecond * elapsed
        : null;

    // The sanity range applies to what is shown, not only to what is read: an
    // extrapolation that leaves it is not a speed we can stand behind, and
    // clamping it to the boundary would invent one. Dropping it re-acquires
    // from the next usable reading, which is what an expired estimate does.
    const predicted =
      extrapolated !== null && extrapolated >= min && extrapolated <= max ? extrapolated : null;

    if (usable && (predicted === null || Math.abs(value - predicted) <= tolerance(elapsed))) {
      if (predicted === null) {
        ratePerSecond = 0; // nothing to measure a rate against
      } else if (elapsed > 0) {
        ratePerSecond = (value - lastAccepted) / elapsed;
        recentRates.push(ratePerSecond);
        if (recentRates.length > GATE_WINDOW) recentRates.shift();
      }
      lastAccepted = value;
      elapsedSinceAccepted = 0;
      suspiciousCandidate = null;
      return { value, status: 'ok' };
    }

    // A reading consistent with the one rejected on the previous sample is adopted as a new
    // level, judged over that one interval, so a step recovers after one confirming sample
    // while a sustained change that keeps outrunning the tolerance expires instead. Agreement
    // between two readings from one sensor is corroboration within this heuristic, not
    // independent evidence: production would need wheel speed, motor RPM or GPS-derived speed.
    if (usable && suspiciousCandidate !== null && Math.abs(value - suspiciousCandidate) <= tolerance(dt ?? 0)) {
      ratePerSecond = dt > 0 ? (value - suspiciousCandidate) / dt : 0;
      lastAccepted = value;
      elapsedSinceAccepted = 0;
      suspiciousCandidate = null;
      return { value, status: 'recovered' };
    }

    suspiciousCandidate = usable ? value : null;
    elapsedSinceAccepted = elapsed;

    if (predicted === null) {
      lastAccepted = null;
      ratePerSecond = 0;
      elapsedSinceAccepted = 0;
      return { value: null, status: 'unavailable' };
    }
    return { value: predicted, status: 'estimated' };
  };
}

// Battery and motor temperature drift slowly enough that the last good reading
// is a better answer than an extrapolation.
function createHeldValueTracker(parseValue, [min, max], maxEstimateAge) {
  let lastAccepted = null;
  let elapsedSinceAccepted = 0;

  return (raw, dt) => {
    const value = parseValue(raw);
    if (value !== null && value >= min && value <= max) {
      lastAccepted = value;
      elapsedSinceAccepted = 0;
      return { value, status: 'ok' };
    }

    elapsedSinceAccepted += dt ?? 0;
    if (lastAccepted === null || elapsedSinceAccepted > maxEstimateAge) {
      lastAccepted = null;
      elapsedSinceAccepted = 0;
      return { value: null, status: 'unavailable' };
    }
    return { value: lastAccepted, status: 'estimated' };
  };
}

export function normalise(entries) {
  if (!Array.isArray(entries)) return [];

  // Sorting works here because this replays a recorded log. A real stream would
  // need sequence numbers and a small reorder buffer instead.
  const ordered = entries
    .filter((entry) => entry && Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Ages in seconds. Battery drifts slowly so a stale value is tolerable for
  // longer; temperature is strictest because a stale reading hides an overheat.
  const speed = createSpeedTracker(3);
  const battery = createHeldValueTracker(parseBattery, BATTERY_RANGE, 5);
  const motorTemp = createHeldValueTracker(parseTemperature, MOTOR_TEMP_RANGE, 2);

  return ordered.map((entry, i) => {
    const gap = i === 0 ? null : (entry.timestamp - ordered[i - 1].timestamp) / 1000;
    const dt = gap > 0 ? gap : null;

    const s = speed(entry.speed, dt);
    const b = battery(entry.battery, dt);
    const m = motorTemp(entry.motorTemp, dt);
    const gps = parseGps(entry.gps);

    return {
      timestamp: entry.timestamp,
      speed: s.value,
      battery: b.value,
      motorTemp: m.value,
      gps,
      quality: {
        speed: s.status,
        battery: b.status,
        motorTemp: m.status,
        gps: gps ? 'ok' : 'unavailable',
      },
    };
  });
}
