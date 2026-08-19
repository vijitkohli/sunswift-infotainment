# Design Choices

The main engineering decisions behind the submission, and the reasoning for each. Assumptions about the vehicle, the data, and the operating environment are recorded separately in `assumptions.md`.

## Q1 normalisation and dashboard

**Causal prediction instead of interpolation.** The dashboard is treated as a live telemetry display, so a missing speed is estimated from the current and earlier accepted readings only. Interpolation was not used because it needs a reading from after the gap, which a live display would not have. However, interpolation remains the better choice for offline reconstruction of a recorded log.

**Fallback strategy differs by field.** Speed is predicted forward, because it changes quickly and simply holding the last value would soon be misleading. Battery and motor temperature normally change more slowly, so the last good reading is held briefly instead. Temperature expires sooner than battery, because a stale temperature could hide an over-temperature condition. GPS is never estimated, since inventing a position is worse than reporting no trustworthy fix.

**Adaptive speed checking with provisional recovery.** No validated vehicle-dynamics specification was supplied, so a fixed acceleration limit would be an invented number. Instead each incoming speed is compared against the recent accepted rates of change, and an unexpected but in-range reading is treated as suspicious rather than impossible. If the next reading agrees with it, the new level is adopted and marked `recovered`. This is heuristic corroboration from the same sensor, not independent confirmation from another source.

**Explicit uncertainty and expiry.** Every field is emitted with a quality status, so the UI can distinguish measured, estimated, recovered, and unavailable values without repeating the normaliser's decisions. Estimates stop at their configured time limits, and once no trustworthy value remains the field returns `null`. Zero is never used as a fallback, because it is a value a sensor can genuinely report. The sanity range bounds the estimate as well as the reading: an extrapolation that leaves it is dropped rather than clamped, because clamping would put an invented number on the gauge.

**Strict field-specific parsing.** Each field accepts only the numeric and unit formats that belong to it: `%` for battery, `C` or `°C` for motor temperature, plain decimals for speed. Malformed strings, and units belonging to another field, are rejected rather than partially parsed.

## Q2 telemetry API

### Implemented design decisions

**In-memory storage, held behind one module.** The brief states that storage is a simple in-memory array and that no database, file I/O, caching layer, or persistence is required, so the store is one array with a `Map` index on the event key. The two must stay in step, so they live behind a single module rather than as loose bindings, and `store.all()` returns a copy: handing out the live array is how a caller would desynchronise the records from the index. The copy costs nothing in order terms, because the caller already walks the records once.

**Separated modules for routing, validation, storage, summary, and startup.** `app.js` wires the routes, `validate.js` decides whether one entry is acceptable, `store.js` holds the records, `summary.js` computes the aggregate, and `server.js` does nothing but bind a port. Validation and summarising are pure functions with no HTTP knowledge, so they are unit-tested directly, and the app can be exercised by tests without opening a socket.

**Strict, non-coercive validation at the ingest boundary.** Types must match exactly: `"72.4"` is rejected rather than parsed, component names are matched case-sensitively and untrimmed, and `value` must be a finite number. This is deliberately the opposite of Q1, and the difference is the direction of the data. Q1 recovers what it can from an already-recorded file it cannot change, where rejecting a reading loses it permanently. Q2 is a boundary where a producer sending the wrong type has a bug that is worth surfacing rather than quietly repairing, since repairing it here would ship that bug onward undetected. Unknown properties are accepted but stripped, so an additive schema change at the producer does not break ingest and nothing undocumented reaches storage.

**Per-entry batch acceptance, reported with `207`.** Each entry is validated and stored independently, so one corrupt frame never discards the independent, valid events uploaded alongside it. The status reports how much of the batch was stored: `200` for all, `207` for some, `400` for none, all three carrying the same upload-result body. `received`, `accepted`, `rejected`, and `totalStored` let a client reconcile the outcome without parsing the error list, and `received = accepted + rejected` always holds.

**Stable, non-echoing error reporting.** Every rejected entry produces one error carrying its zero-based index in the submitted array, a stable code, and — for validation failures — field-level `details` listing every problem in that entry at once, so a producer can fix them in one pass. A missing field reports `MISSING_FIELD` alone and does not cascade into a type error. Submitted values are never echoed back: the client still holds the payload, and the index points straight into it.

**Composite event identity, create-only `POST`.** An event is keyed on `(timestamp, component)`. The same key with the same value is reported as `DUPLICATE_EVENT`, and the same key with a different value as `EVENT_CONFLICT`; stored telemetry is never overwritten. This makes retries predictable, and rests on the assumption that a component produces at most one reading per millisecond. Correcting a stored reading is a different operation from uploading one, and belongs in `PUT` or `PATCH` semantics this API does not define.

**Summary recomputed from stored events on request.** Counts, minimums, maximums, averages, and the latest event are calculated in a single pass when the summary is requested, rather than maintained as running aggregates that would be a second source of truth able to drift out of step with the records. The store is intentionally small, so the extra pass is cheap.

**Summary representation.** All three components always appear, and a component holding no events reports `null` statistics rather than zeros, because `0` is a reading a sensor can genuinely produce and cannot also mean "none" — the same rule the Q1 dashboard follows when it renders `--`. Averages are returned unrounded, since how many decimals to show is a presentation concern and rounding here would discard information the caller cannot recover. Latest means the greatest timestamp rather than the most recently uploaded event, so a late batch of older readings cannot displace a newer one; the comparison is strictly greater, so the earliest stored record wins a tie and the result is deterministic.

**No invented domain constraints.** No per-component value ranges and no plausible-date window are enforced, because the brief supplies no validated vehicle specifications and the `gps` value channel's semantics are undocumented — its own example shows values between 0.0123 and 0.1290, which are not coordinates. Bounding either would mean asserting a model that was never given.

**OpenAPI specification and Swagger UI retained.** The contract lives in a standalone `openapi.yaml` rather than jsdoc annotations, which would bury the handlers under comment blocks longer than the code, and it is served at `/docs` so a reviewer can read and exercise the API without a REST client. The cost is two runtime dependencies that exist only to serve documentation. That is a deliberate trade for assessment usability; a production service would serve the specification as a static artefact rather than mounting a UI in the API process.

### Assumptions this design rests on

Two are load-bearing enough to state alongside the decisions: that a component emits at most one logical event per millisecond, which is what makes `(timestamp, component)` a usable identity, and that producer clocks are accurate enough for identity and latest-event selection. The full set, including the unspecified meaning of `value` and the properties of the in-memory store, is recorded in `assumptions.md` §3.

### Known limitations

These are properties of the submitted implementation, stated plainly rather than as defects in the required scope.

- A fully replayed batch returns `400` with every entry marked `DUPLICATE_EVENT`. Nothing was stored twice, but the status reports that nothing new was stored rather than that the payload was malformed, and one status code cannot express both.
- `400` therefore carries two body shapes: the upload-result body when no entry was accepted, and the request-level error envelope when the batch never reached entry processing. A client distinguishes them by the presence of `received` versus `error`.
- A request whose body is a valid batch but whose `Content-Type` is not JSON is not parsed, so it reaches the array guard and returns `BODY_NOT_ARRAY` — accurate about the parsed body, but not naming the header as the real problem.
- The body parser's default size limit of 100 kB applies. It is a framework default rather than a chosen, documented limit, and a request exceeding it is reported as `500`, as are unsupported or invalid content encodings.
- The store grows without eviction, holds nothing across a restart, is confined to one process, and has no authentication, authorisation, or rate limiting.

### Deferred production improvements

Each of these is a change a production telemetry service would reasonably make. They were left out because the brief does not ask for them and because most would expand the public contract beyond what it specifies.

**Exact-replay semantics.** The current contract counts an exact duplicate as a rejected entry, which is a simple and consistent rule: `rejected` means "not newly stored", for any reason. In production, intermittent communication means a sender may repeat a batch after losing the original response, so an identical retry is better treated as an idempotent success — reported separately in the response body, with rejection reserved for entries that are invalid or that conflict. Conflicting events, where the same identity carries a different value, should stay distinct from exact replays in any such design. This was not implemented because it requires coordinated changes to the response fields, the status semantics, the OpenAPI document, the tests, and client expectations.

**More expressive status semantics.** A production contract could separate malformed requests, semantically invalid entries, conflicts, exact replays, and partial success across `400`, `422`, `409`, `200`, and `207`. The submitted contract folds the all-rejected case into `400` and leans on the response body instead, which still lets a client tell request-level errors, invalid entries, duplicates, and conflicts apart through stable codes. The refinement was deferred to avoid expanding the public contract beyond the brief.

**Content-Type handling.** A production API should reject an unsupported media type explicitly, with `415 Unsupported Media Type`. Correcting this adds a new public status and a new error code, so it was deferred rather than introduced alongside a contract the brief does not describe.

**Parser and payload errors.** Oversized bodies and unsupported or invalid content encodings should preserve their client-error status rather than falling through to a generic `500`, and a production service should choose and document a request-size limit rather than inheriting the parser's default, returning `413 Payload Too Large` when it is exceeded. Neither is required by the brief, and both would change the documented error contract.

**Bounded and persistent storage.** Retention would need a policy — a maximum event count, a time window, or both — and telemetry that outlives a restart would need durable storage chosen for the write pattern. The brief explicitly excludes databases, file I/O, and persistence, so this is outside the task rather than missing from it.

**Scalable summary generation.** Recomputing on request is the right choice at this size. At larger volumes the options are indexed queries, streaming aggregation, or maintained aggregates. Maintained aggregates reintroduce the second source of truth this design deliberately avoids, so they are worth adding only when measured scale shows the single pass is genuinely the constraint.

**Validated domain constraints.** Per-component ranges, declared units, timestamp bounds, and schema versioning all belong in a production API, sourced from engineering-approved specifications. They are omitted here deliberately: inventing limits for battery, motor, GPS, or timestamps without those specifications would encode guesses as validation rules and reject real data.

**Stronger event identity.** `(timestamp, component)` is sufficient for this exercise but depends on the one-reading-per-millisecond assumption. Production telemetry would more likely carry a producer-generated event ID, a subsystem identifier, a sequence number, or a higher-resolution timestamp. Any replacement must keep retries safe and define conflict behaviour just as explicitly.

**Operational concerns.** A deployed service would also need authentication and authorisation, transport security, rate limiting, structured logging and metrics, an audit trail for stored telemetry, health checks, and graceful shutdown. All are outside the assessment's scope and none is implemented here.
