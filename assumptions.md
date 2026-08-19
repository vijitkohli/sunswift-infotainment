# Assumptions

This document records the assumptions on which the submission depends. Detailed design decisions, trade-offs, and known limitations are documented separately.

## 1. Question 1: Telemetry normalisation

### 1.1 Speed uses broad application-level bounds

Speed is treated as a non-negative magnitude, and readings from 0 to 200 km/h are accepted for further evaluation. The upper bound is a broad application-level sanity limit chosen for this exercise, not a validated physical maximum. Production software would derive this value from tested vehicle specifications.

### 1.2 Suspicious speeds can only be corroborated by the same sensor

The input contains one speed source. If a suspicious reading is followed by a similar reading, the normaliser treats the later reading as recovered. This is corroboration within the heuristic, not independent confirmation, because a consistently faulty sensor can confirm itself. A production system would compare speed with an independent source such as wheel speed, motor RPM, or GPS-derived speed.

### 1.3 A repeated zero may mean either a stopped vehicle or a failed sensor

Zero is a valid speed reading and cannot also be used to represent missing data. With no independent sensor-health signal, repeated zero readings cannot be distinguished from a genuinely stopped vehicle and may therefore be accepted as a recovered speed level.

### 1.4 Short-term speed prediction assumes local continuity

For a limited period, the normaliser assumes that the most recently accepted rate of change remains useful for estimating missing or suspicious speed readings.

### 1.5 Estimates remain useful for a bounded, field-specific time

Battery and motor temperature change slowly enough that the most recent accepted value can be held briefly when a reading is missing or invalid. Speed estimates remain available for up to three seconds, battery values for up to five seconds, and motor-temperature values for up to two seconds. A value at exactly its configured horizon remains available; it expires once the elapsed time exceeds that horizon.

### 1.6 Recent speed changes help identify unusual readings

The normaliser compares each new speed reading with recent accepted changes in speed. The thresholds are practical values chosen for this sample, not proven limits of the vehicle.

### 1.7 The recorded file is complete and its timestamps define order and elapsed time

The complete telemetry file is available before replay, so `normalise()` sorts rows by timestamp first. Timestamps are assumed to reflect the intended order of readings and the real time elapsed between them. After sorting, each row is processed causally using only current and earlier readings, as it would be in a live stream. Duplicate timestamps are retained, and no positive time is assumed to have elapsed between them.

### 1.8 Missing GPS is represented explicitly

A missing or invalid GPS fix is represented as `null` rather than estimated. Because the supplied format does not define `{ lat: 0, lng: 0 }` as a missing-fix marker, the normaliser treats it as a valid location.

### 1.9 The recorded sample is small enough to process in memory

The full telemetry array is sorted and normalised in memory. This is assumed to be proportionate to the supplied synthetic dataset.

## 2. Question 1: Interface and replay

### 2.1 Replay timing is fixed for the supplied sample

The interface replays one row per second. This assumes the supplied sample is 1 Hz and does not attempt to reproduce arbitrary timestamp spacing in real time.

## 3. Question 2: Telemetry API

### 3.1 The meaning and unit of a Q2 value are unspecified

The schema does not define component-specific units or meanings for `value`. The API therefore assumes only that it is a finite JSON number and applies no component-specific ranges.

### 3.2 A component emits at most one logical event per millisecond

`(timestamp, component)` is treated as the event identity. The API assumes that one component cannot legitimately produce two distinct readings with the same millisecond timestamp. An identical value at the same key is a duplicate; a different value at the same key is a conflict.

### 3.3 Producer clocks are reliable enough for identity and ordering

Non-negative integer milliseconds since the Unix epoch are the API contract for `timestamp`. The assumption is that producer clocks are accurate enough for event identity and latest-event selection. No plausible-date window is imposed.

### 3.4 The in-memory store is single-process, temporary, and small

The API assumes one application process, a small amount of telemetry, and no persistence requirement. Stored data is lost on restart, is not shared across instances, and has no retention or eviction policy. The store is assumed to remain small enough for each summary request to scan it fully.

### 3.5 The exercise does not define caller identity or authorisation

No authentication or authorisation model is implemented because none is supplied by the assessment contract.
