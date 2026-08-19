/**
 * Telemetry ingest API in which entries are validated and stored independently, so one corrupt
 * frame never discards a batch of otherwise-usable vehicle data: 200 when all are stored, 207
 * when some are, 400 when none are, each carrying one upload-result body that reports every
 * rejection by index. Validation is strict and non-coercive because a producer sending the
 * wrong type at an ingest boundary is a bug worth surfacing rather than repairing, so types
 * must match the documented schema exactly and only normalised {timestamp, component, value}
 * copies are stored. Storage is one in-memory array with a Map index, which is proportionate to
 * an exercise needing no persistence and lets the summary be recomputed in a single pass per
 * request instead of running aggregates that could drift out of step with the records. It
 * assumes (timestamp, component) identifies an event — that one component cannot produce two
 * readings in the same millisecond — which makes uploads idempotent: a re-sent key is reported
 * as a duplicate or a conflict and never overwrites what is already held. Errors are explicit
 * and never echo submitted values back, with per-entry failures listing every bad field at
 * once, while a request that is not a batch at all returns a coded error envelope instead.
 */

import { readFileSync } from 'node:fs';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { store } from './store.js';
import { validateEntry } from './validate.js';
import { summarise } from './summary.js';

const app = express();
app.use(express.json());

// The spec is a standalone file rather than jsdoc annotations, which would bury these
// handlers under comment blocks longer than the code they describe.
const openapi = parseYaml(readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

const requestError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

app.post('/logs/upload', (req, res) => {
  // express.json() is strict, so a JSON null, string or number body is rejected as unparseable
  // before reaching here. What arrives is either an object or, when the request carried no JSON
  // content type, an unparsed undefined body. Neither is a batch.
  if (!Array.isArray(req.body)) {
    return requestError(res, 400, 'BODY_NOT_ARRAY', 'Request body must be a JSON array of log entries');
  }
  if (req.body.length === 0) {
    return requestError(res, 400, 'EMPTY_BATCH', 'Request body must contain at least one log entry');
  }

  const errors = [];
  let accepted = 0;

  req.body.forEach((entry, index) => {
    const { record, details } = validateEntry(entry);
    if (details) {
      errors.push({ index, code: 'INVALID_ENTRY', message: 'Entry failed validation', details });
      return;
    }

    // Accepted entries are stored as we go, so this check also catches a key repeated later in
    // the same batch without tracking pending entries separately.
    const existing = store.existing(record.timestamp, record.component);
    if (existing !== undefined) {
      // Never overwritten. Correcting a stored reading would need PUT or PATCH semantics this
      // API does not define, so a re-sent key is reported rather than applied.
      errors.push(
        existing === record.value
          ? {
              index,
              code: 'DUPLICATE_EVENT',
              message: `An identical event for component '${record.component}' at timestamp ${record.timestamp} is already stored`,
            }
          : {
              index,
              code: 'EVENT_CONFLICT',
              message: `An event for component '${record.component}' at timestamp ${record.timestamp} is already stored with value ${existing}`,
            },
      );
      return;
    }

    store.add(record);
    accepted += 1;
  });

  const received = req.body.length;
  const status = accepted === received ? 200 : accepted === 0 ? 400 : 207;

  // Errors never echo the submitted entry: the client still holds the payload, and the
  // zero-based index points straight into it.
  res.status(status).json({ received, accepted, rejected: received - accepted, totalStored: store.size, errors });
});

app.get('/logs/summary', (req, res) => {
  // An empty store is a valid state rather than a missing resource, so this is always 200.
  res.json(summarise(store.all()));
});

// The base URL is the first thing a reader tries, so send them to the documentation rather
// than a 404 that is technically correct and practically useless.
app.get('/', (req, res) => res.redirect('/docs'));

app.use((req, res) => {
  requestError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`);
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return requestError(res, 400, 'MALFORMED_JSON', 'Request body could not be parsed as JSON');
  }
  return requestError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

export default app;
