// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { cloneElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ResponsiveContainer measures its parent and jsdom has no layout, so without
// explicit dimensions the chart renders empty and every assertion below passes
// vacuously.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => cloneElement(children, { width: 600, height: 260 }),
  };
});

const { default: SpeedChart, speedDomain } = await import('./SpeedChart.jsx');

afterEach(cleanup);

const rows = (...speeds) =>
  speeds.map(([speed, status], i) => ({ timestamp: i * 1000, speed, quality: { speed: status } }));

describe('speedDomain', () => {
  const at = (...speeds) => speedDomain(speeds.map((speed) => ({ speed })));

  it('holds still at 0-100 for ordinary speeds', () => {
    expect(at(70, 80, 75)).toEqual([0, 100]);
    expect(at(null, null)).toEqual([0, 100]);
    expect(speedDomain([])).toEqual([0, 100]);
  });

  it('expands to the next multiple of 10 when the car outruns the axis', () => {
    expect(at(70, 110)).toEqual([0, 120]);
    expect(at(70, 96)).toEqual([0, 110]);
  });

  it('ignores gaps rather than letting them collapse the axis', () => {
    expect(at(70, null, 80, null, 75).every(Number.isFinite)).toBe(true);
  });
});

describe('SpeedChart', () => {
  it('says so rather than drawing an empty axis when there is nothing to plot', () => {
    const { container } = render(<SpeedChart rows={[]} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('No telemetry to plot');
  });

  it('marks only the points the cleaning had a hand in', () => {
    const { container } = render(
      <SpeedChart rows={rows([80, 'ok'], [79, 'ok'], [78, 'estimated'], [70, 'recovered'], [69, 'ok'])} />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('circle.dot.estimated')).toHaveLength(1);
    expect(container.querySelectorAll('circle.dot.recovered')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('breaks the trace at an expired estimate instead of drawing through it', () => {
    const { container } = render(
      <SpeedChart rows={rows([80, 'ok'], [79, 'ok'], [null, 'unavailable'], [70, 'ok'], [69, 'ok'])} />,
    );
    // Recharts emits a fresh moveto per run of defined points, so a hole shows up
    // as a second M command rather than a continuous path.
    expect(container.querySelector('path.recharts-curve').getAttribute('d').match(/M/g)).toHaveLength(2);
  });
});
