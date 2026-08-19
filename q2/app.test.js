import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from './app.js';
import { store } from './store.js';

const event = (timestamp, component, value) => ({ timestamp, component, value });

const upload = (body) => request(app).post('/logs/upload').send(body);

beforeEach(() => store.clear());

describe('POST /logs/upload', () => {
  it('returns 200 when every entry is accepted', async () => {
    const res = await upload([event(1000, 'battery', 72.4), event(1000, 'motor', 61)]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 2, accepted: 2, rejected: 0, totalStored: 2, errors: [] });
  });

  it('returns 207 when a batch is partially accepted', async () => {
    const res = await upload([event(1000, 'battery', 72.4), event(2000, 'flux', 5), event(3000, 'motor', 61)]);
    expect(res.status).toBe(207);
    expect(res.body.accepted).toBe(2);
    expect(res.body.rejected).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].index).toBe(1);
    expect(res.body.errors[0].details[0].code).toBe('INVALID_COMPONENT');
  });

  it('stores the valid entries of a partially accepted batch', async () => {
    await upload([event(1000, 'battery', 72.4), { component: 'motor' }]);
    const { body } = await request(app).get('/logs/summary');
    expect(body.count).toBe(1);
    expect(body.components.battery.count).toBe(1);
  });

  it('returns 400 in the upload-result shape when no entry is accepted', async () => {
    const res = await upload([{ component: 'motor' }, { timestamp: 'soon' }]);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ received: 2, accepted: 0, rejected: 2, totalStored: 0 });
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.error).toBeUndefined();
  });

  it('keeps received equal to accepted plus rejected', async () => {
    const res = await upload([event(1000, 'battery', 72.4), { component: 'motor' }, event(1000, 'battery', 72.4)]);
    expect(res.body.received).toBe(res.body.accepted + res.body.rejected);
    expect(res.body.errors).toHaveLength(res.body.rejected);
  });

  it('accepts a value of 0', async () => {
    const res = await upload([event(1000, 'battery', 0)]);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
  });

  it('rejects a re-sent identical event as DUPLICATE_EVENT', async () => {
    await upload([event(1000, 'battery', 72.4)]);
    const res = await upload([event(1000, 'battery', 72.4)]);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('DUPLICATE_EVENT');
    expect(res.body.totalStored).toBe(1);
  });

  it('rejects a re-sent key carrying a different value as EVENT_CONFLICT', async () => {
    await upload([event(1000, 'battery', 72.4)]);
    const res = await upload([event(1000, 'battery', 68.1)]);
    expect(res.body.errors[0].code).toBe('EVENT_CONFLICT');
    // The stored reading is reported, never overwritten.
    const { body } = await request(app).get('/logs/summary');
    expect(body.components.battery.max).toBe(72.4);
  });

  it('allows different components to share a timestamp', async () => {
    const res = await upload([event(1000, 'battery', 72.4), event(1000, 'motor', 61), event(1000, 'gps', 0.02)]);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(3);
  });

  it('rejects a duplicate key within one batch, keeping the first occurrence', async () => {
    const res = await upload([event(1000, 'battery', 72.4), event(1000, 'battery', 99)]);
    expect(res.status).toBe(207);
    expect(res.body.errors[0].index).toBe(1);
    expect(res.body.errors[0].code).toBe('EVENT_CONFLICT');
  });

  it('does not echo submitted values back in errors', async () => {
    const res = await upload([{ timestamp: 1000, component: 'battery', value: 'secret' }]);
    expect(JSON.stringify(res.body.errors)).not.toContain('secret');
  });

  it('returns 400 BODY_NOT_ARRAY for a non-array body', async () => {
    for (const body of [{}, event(1000, 'battery', 72.4), 'battery']) {
      const res = await upload(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BODY_NOT_ARRAY');
    }
  });

  it('returns 400 EMPTY_BATCH for an empty array', async () => {
    const res = await upload([]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_BATCH');
  });

  it('returns 400 MALFORMED_JSON for a body that cannot be parsed', async () => {
    const res = await request(app).post('/logs/upload').set('Content-Type', 'application/json').send('{"broken"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects a JSON null, string or number body before the array guard', async () => {
    // express.json() is strict, so these never reach the handler and are reported as
    // unparseable rather than as the wrong shape.
    for (const body of ['null', '"battery"', '42']) {
      const res = await request(app).post('/logs/upload').set('Content-Type', 'application/json').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MALFORMED_JSON');
    }
  });

  it('returns 400 BODY_NOT_ARRAY when a valid batch is sent without a JSON content type', async () => {
    const res = await request(app)
      .post('/logs/upload')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify([event(1000, 'battery', 72.4)]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BODY_NOT_ARRAY');
  });

  it('rejects a value that JSON parses to Infinity', async () => {
    // 1e999 is legal JSON and parses to Infinity, so the finite check is reachable over HTTP.
    const res = await request(app)
      .post('/logs/upload')
      .set('Content-Type', 'application/json')
      .send('[{"timestamp":1000,"component":"battery","value":1e999}]');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].details[0]).toMatchObject({ field: 'value', code: 'INVALID_TYPE' });
  });
});

describe('GET /logs/summary', () => {
  it('returns 200 with a zeroed shape when nothing is stored', async () => {
    const res = await request(app).get('/logs/summary');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.latest).toBeNull();
    expect(res.body.components.battery).toEqual({ min: null, max: null, avg: null, count: 0 });
  });

  it('returns per-component statistics and the latest event by timestamp', async () => {
    await upload([event(3000, 'battery', 70), event(1000, 'battery', 76), event(2000, 'motor', 61)]);
    const res = await request(app).get('/logs/summary');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.components.battery).toEqual({ min: 70, max: 76, avg: 73, count: 2 });
    expect(res.body.latest).toEqual(event(3000, 'battery', 70));
  });

  it('keeps the newest timestamp when an older batch is uploaded afterwards', async () => {
    await upload([event(5000, 'battery', 70)]);
    await upload([event(1000, 'motor', 61)]);
    const { body } = await request(app).get('/logs/summary');
    expect(body.latest).toEqual(event(5000, 'battery', 70));
  });
});

describe('store', () => {
  it('hands out a copy, so a caller cannot desynchronise the records from the key index', async () => {
    await upload([event(1000, 'battery', 72.4)]);
    store.all().push(event(9999, 'motor', 999));
    const { body } = await request(app).get('/logs/summary');
    expect(body.count).toBe(1);
    expect(body.latest).toEqual(event(1000, 'battery', 72.4));
  });
});

describe('base URL', () => {
  it('redirects to the API documentation', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/docs');
  });
});

describe('unmatched routes', () => {
  it('returns 404 NOT_FOUND as JSON', async () => {
    const res = await request(app).post('/logs/uplaod').send([]);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
