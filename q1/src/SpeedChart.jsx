import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Fixed 0-100 unless the car goes faster, so the axis holds still during replay
// instead of rescaling on every sample. Rounded to a multiple of 10 so the ticks
// below always land on the top of the axis. Recharts' 'dataMin - 5' shorthand
// also counts null gaps as data and collapses the axis to +/-Infinity.
export function speedDomain(rows) {
  const known = rows.map((row) => row.speed).filter(Number.isFinite);
  if (known.length === 0) return [0, 100];
  return [0, Math.max(100, Math.ceil((Math.max(...known) + 5) / 10) * 10)];
}

// Measured points are left unmarked so the exceptions are what catch the eye.
function QualityDot({ cx, cy, payload }) {
  if (cx == null || cy == null || payload.status === 'ok') return null;
  return <circle cx={cx} cy={cy} r={3.5} className={`dot ${payload.status}`} />;
}

export default function SpeedChart({ rows }) {
  if (rows.length === 0) return <p className="note">No telemetry to plot.</p>;

  const start = rows[0].timestamp;
  const data = rows.map((row) => ({
    seconds: Math.round((row.timestamp - start) / 1000),
    speed: row.speed,
    status: row.quality.speed,
  }));

  const [, top] = speedDomain(rows);
  const ticks = Array.from({ length: top / 10 + 1 }, (_, i) => i * 10);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" />
        {/* interval={0} on both axes: Recharts otherwise drops every other tick
            label when it thinks they will collide, which reads as the data being
            sampled every 2s when it is actually every 1s. */}
        <XAxis
          dataKey="seconds"
          interval={0}
          tick={{ fontSize: 11 }}
          tickMargin={6}
          height={46}
          label={{ value: 'time since first sample (s)', position: 'insideBottom', offset: 2 }}
        />
        <YAxis
          domain={[0, top]}
          ticks={ticks}
          interval={0}
          tick={{ fontSize: 11 }}
          width={72}
          tickMargin={4}
          label={{ value: 'speed (km/h)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
        />
        <Tooltip
          formatter={(value, _name, item) => [
            `${value.toFixed(1)} km/h`,
            item.payload.status === 'ok' ? 'measured' : item.payload.status,
          ]}
          labelFormatter={(seconds) => `t + ${seconds}s`}
        />
        {/* connectNulls off, so an expired estimate leaves a hole rather than a
            straight line drawn through data we do not have. */}
        <Line
          type="monotone"
          dataKey="speed"
          stroke="#1f6feb"
          strokeWidth={2}
          connectNulls={false}
          dot={<QualityDot />}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
