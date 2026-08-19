/*
 * All cleaning lives in lib/normalise.js, so the parsing rules can be tested
 * without a browser and this file only decides how to present them. Every
 * channel arrives with a quality status, which is the only thing the UI branches
 * on: a measured value is shown plainly, an estimated one is labelled, and an
 * expired one shows a dash rather than a stale number or a zero. The readouts
 * follow the last sample received, so the log can be rendered whole or replayed
 * a sample at a time to show how the display behaves while data is dropping out.
 * It reads telemetry_overheat.json, which is the supplied sample continued into
 * a climb so that the over temperature warning has data that triggers it.
 */
import { useEffect, useMemo, useState } from 'react';

import { normalise } from '../lib/normalise.js';
import telemetry from '../telemetry_overheat.json';
import SpeedChart from './SpeedChart.jsx';

const OVERHEAT_LIMIT = 90;
const REPLAY_INTERVAL = 1000;

const NOTES = {
  ok: '',
  estimated: 'estimated',
  recovered: 'confirmed late',
  unavailable: 'no signal',
};

function Readout({ label, value, unit, status, alert = false }) {
  return (
    <div className={`readout ${status}${alert ? ' alert' : ''}`} role={alert ? 'alert' : undefined}>
      <span className="label">{label}</span>
      <span className="value">
        {value === null ? '--' : value.toFixed(1)}
        {value !== null && <span className="unit">{unit}</span>}
      </span>
      <span className="note">{alert ? 'over temperature' : NOTES[status]}</span>
    </div>
  );
}

export default function Dashboard() {
  const rows = useMemo(() => normalise(telemetry), []);
  const [shown, setShown] = useState(rows.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    if (shown >= rows.length) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown((n) => n + 1), REPLAY_INTERVAL);
    return () => clearTimeout(timer);
  }, [playing, shown, rows.length]);

  // Slicing already-normalised rows is only safe because the cleaning is causal:
  // row n never depends on anything after it.
  const visible = rows.slice(0, shown);
  const latest = visible.at(-1);
  const cleaned = visible.filter((row) => Object.values(row.quality).some((s) => s !== 'ok')).length;

  return (
    <main className="dashboard">
      <h1>Dashboard</h1>

      {latest && (
        <div className="readouts">
          <Readout label="Speed" value={latest.speed} unit="km/h" status={latest.quality.speed} />
          <Readout label="Battery" value={latest.battery} unit="%" status={latest.quality.battery} />
          <Readout
            label="Motor"
            value={latest.motorTemp}
            unit="°C"
            status={latest.quality.motorTemp}
            alert={latest.motorTemp !== null && latest.motorTemp > OVERHEAT_LIMIT}
          />
        </div>
      )}

      <SpeedChart rows={visible} />

      <div className="controls">
        <button type="button" onClick={() => setPlaying((on) => !on)} disabled={shown >= rows.length && !playing}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => {
            setShown(1);
            setPlaying(true);
          }}
        >
          Replay from start
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setShown(rows.length);
          }}
          disabled={shown >= rows.length}
        >
          Show full log
        </button>
        <span className="note">
          {shown} / {rows.length} samples, {cleaned} needed cleaning
        </span>
      </div>
    </main>
  );
}
