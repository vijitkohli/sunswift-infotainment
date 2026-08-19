const COMPONENTS = ['battery', 'motor', 'gps'];

// Validates one uploaded entry. Returns either { record } holding a normalised copy, or
// { details } listing every problem found.
//
// Nothing is coerced. Q1 recovers "72.6%" from a supplied file it cannot change, where
// rejecting the reading would lose it permanently; this is an ingest boundary, where a
// producer sending the wrong type can be fixed. Strictness is a feature on this side of it.
export function validateEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { details: [{ field: null, code: 'INVALID_TYPE', message: 'Entry must be a JSON object' }] };
  }

  const details = [];

  // Each field reports at most once: a missing field is missing, not also mistyped.
  if (entry.timestamp === undefined) {
    details.push({ field: 'timestamp', code: 'MISSING_FIELD', message: 'timestamp is required' });
  } else if (!Number.isInteger(entry.timestamp) || entry.timestamp < 0) {
    // No plausible-date window. Bounding this to "recent" timestamps would assert a
    // deployment timeline we were not given.
    details.push({
      field: 'timestamp',
      code: 'INVALID_TYPE',
      message: 'timestamp must be a non-negative integer number of milliseconds since epoch',
    });
  }

  if (entry.component === undefined) {
    details.push({ field: 'component', code: 'MISSING_FIELD', message: 'component is required' });
  } else if (typeof entry.component !== 'string') {
    details.push({ field: 'component', code: 'INVALID_TYPE', message: 'component must be a string' });
  } else if (!COMPONENTS.includes(entry.component)) {
    // Matched exactly, with no trimming or lowercasing. A producer emitting "Battery " has a
    // bug, and repairing it here would ship that bug to production undetected.
    details.push({
      field: 'component',
      code: 'INVALID_COMPONENT',
      message: `component must be one of: ${COMPONENTS.join(', ')}`,
    });
  }

  if (entry.value === undefined) {
    details.push({ field: 'value', code: 'MISSING_FIELD', message: 'value is required' });
  } else if (!Number.isFinite(entry.value)) {
    // No per-component ranges: the brief's own example shows gps values of 0.0123-0.1290,
    // which are not coordinates, so bounding that channel would mean inventing its meaning.
    details.push({ field: 'value', code: 'INVALID_TYPE', message: 'value must be a finite number' });
  }

  if (details.length > 0) return { details };

  // Only the documented fields are carried forward, so nothing undocumented can reach the
  // store or leak back out through the summary's latest event.
  return { record: { timestamp: entry.timestamp, component: entry.component, value: entry.value } };
}

export { COMPONENTS };
