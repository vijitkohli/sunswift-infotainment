# Q1 — Telemetry parsing and visualisation

`npm install && npm run dev`, then open the printed URL. `npm test` runs the suite.

- `lib/normalise.js` — all cleaning. Pure, no React.
- `src/Dashboard.jsx` — readouts, over-temperature warning, static/replay toggle.
- `src/SpeedChart.jsx` — Recharts speed trace.
- `telemetry_sample.json` — supplied by Sunswift, unmodified.
- `telemetry_overheat.json` — the supplied rows plus a 12-sample temperature climb. The app
  reads this one, because the supplied sample peaks at 76.9 °C and the required
  `motorTemp > 90` branch would otherwise never be seen.

## Cleaning approach

Every channel emits a value and one of four qualities, and the UI branches on nothing else:

| Quality | Meaning | Rendering |
|---|---|---|
| `ok` | Measured, taken at face value | Plain |
| `estimated` | Predicted or held | Dimmed, labelled, marked on the chart |
| `recovered` | A suspicious reading a later sample confirmed | Dimmed, labelled, marked |
| `unavailable` | Expired or unusable | `--`, never `0`, hole in the chart trace |

Zero is a reading a sensor can genuinely produce, so it is never used as a fallback.
`0 km/h` on a moving car is the most dangerous value the UI could show.

### Speed: causal prediction

The tracker keeps the last accepted reading, the rate of change measured between the last two
accepted readings, and the time elapsed since. A missing or rejected reading is answered with
`lastAccepted + rate × elapsed`, so an estimate ages correctly across several bad samples in a
row and across irregular intervals.

The sanity range bounds the estimate, not only the reading. An extrapolation that leaves
0–200 km/h is dropped rather than clamped: the channel reports `unavailable` and re-acquires
from the next usable reading. Clamping would put an invented number on the gauge, and the range
is a definitional floor plus a broad ceiling, not a claimed vehicle limit. Without this, a car
decelerating to a stop reports a negative speed after a two-sample dropout.

Interpolating between the samples either side of a gap is more accurate — index 12 interpolates
to 74.0 where this predicts 74.5 — but it needs the sample *after* the gap, which does not exist
on a live stream. Interpolation stays correct for offline analysis; it is wrong for a live
readout, and the brief describes a live stream.

The same prediction doubles as the plausibility check, so dropouts, spikes and missing values go
through one mechanism instead of three special cases.

### The tolerance is measured, not asserted

An earlier version rejected anything beyond a fixed 12 km/h/s. That asserts a vehicle dynamics
model nobody gave us, and it silently relabels genuine hard driving as a sensor fault — exactly
when speed matters most. The tolerance is now 6 × the median of the last 10 accepted rates,
floored at 2 km/h/s of sensor noise, scaled by the elapsed time being predicted across. On the
sample it settles near 3–4 km/h/s, close to the old fixed figure, without anyone claiming it.
It also widens by itself under aggressive driving, which is street/track adaptation with no
mode switch.

### Rejection is provisional

A sensor glitch does not repeat; a manoeuvre does. A rejected but in-range reading is kept for
one sample, and if the next reading agrees with it the new level is accepted (`recovered`). A step
to a new level therefore recovers after one confirming sample. A sustained change that keeps
outrunning the tolerance may not corroborate at all: the value stays labelled `estimated` until
the three-second estimate horizon expires, then shows `unavailable`, and the tracker re-acquires
from the next usable reading. Accepting sustained suspicious patterns sooner would also accept a
consistently failing sensor sooner, so this is documented rather than fixed.

Two readings from the same sensor are corroboration within this heuristic, not independent
confirmation: a consistently failing sensor confirms itself. Production should cross-check GPS, wheel speed or motor RPM. That is
also why the speed sanity ceiling is kept: it catches a sensor stuck high, which corroboration
would otherwise accept as a new level. Nothing catches a sensor stuck at `0`; from the speed
channel alone it is indistinguishable from stopping.

GPS was investigated as that cross-check and rejected on evidence: haversine over consecutive
fixes yields a flat 52.0 km/h for the whole file while the reported speed decays 82.1 → 67.8.
The synthetic track disagrees with the speed channel, and drops out at index 17.

### Considered and rejected

- **Alpha-beta / Kalman filtering.** Built and measured. It produced 74.72 where the 30-line
  predictor produced 74.50, for ~80 lines of signal processing. No measurable gain on this data.
- **Dropping a whole row on one bad field.** Subsystems are independent; a bad speed reading
  should not discard a good battery, temperature and fix at the same timestamp.
- **Nulling everything unrecoverable.** Handling missing values is the task.
- **A separate quality for coerced strings.** `"72.6%"` → `72.6` loses nothing, so it is `ok`.
  That a subsystem emits malformed data belongs in an engineer-facing log, not on a driver's screen.

### Deliberate deviation from the spec's shape

The spec types `speed` as `number`. This emits `null` once an estimate expires, and `quality`
tells the UI to render `--`. Inventing a number indefinitely is the failure the module exists
to prevent.
