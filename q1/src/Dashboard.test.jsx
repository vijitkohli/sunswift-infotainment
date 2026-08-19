// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Dashboard from './Dashboard.jsx';

afterEach(cleanup);

const tile = (label) => screen.getByText(label).closest('.readout');

describe('Dashboard', () => {
  it('shows the last sample in the log', () => {
    render(<Dashboard />);
    expect(within(tile('Speed')).getByText('60.9')).toBeTruthy();
    expect(within(tile('Battery')).getByText('69.0')).toBeTruthy();
    expect(within(tile('Motor')).getByText('95.0')).toBeTruthy();
  });

  it('warns on the temperature the log ends at', () => {
    render(<Dashboard />);
    const motor = tile('Motor');
    expect(motor.className).toContain('alert');
    expect(within(motor).getByText('over temperature')).toBeTruthy();
    expect(screen.getByRole('alert')).toBe(motor);
  });

  it('leaves the warning off while the motor is still cool', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Replay from start'));

    expect(within(tile('Speed')).getByText('82.1')).toBeTruthy();
    expect(tile('Motor').className).not.toContain('alert');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports how much of the log needed cleaning', () => {
    render(<Dashboard />);
    expect(screen.getByText('36 / 36 samples, 7 needed cleaning')).toBeTruthy();
  });
});
