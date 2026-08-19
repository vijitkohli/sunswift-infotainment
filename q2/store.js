// In-memory store for accepted telemetry events.
//
// The records array and the key index must stay in step, so they live behind one module
// rather than as two loose bindings that a future caller could update independently.

const records = [];
const index = new Map();

const keyOf = (timestamp, component) => `${timestamp}:${component}`;

export const store = {
  // Returns the stored value for this event key, or undefined if the key is free. Values are
  // always finite numbers, so undefined is unambiguous.
  existing(timestamp, component) {
    return index.get(keyOf(timestamp, component));
  },

  add(record) {
    records.push(record);
    index.set(keyOf(record.timestamp, record.component), record.value);
  },

  // A copy, in arrival order and unsorted. Handing out the live array is how the records and
  // the key index get out of step, and the caller already walks it once, so the copy is free in
  // order terms. Sorting on insert would cost O(n log n) per upload to answer a question a
  // single pass over the records already answers.
  all() {
    return [...records];
  },

  get size() {
    return records.length;
  },

  clear() {
    records.length = 0;
    index.clear();
  },
};
