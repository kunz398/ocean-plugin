import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real chart does full Plotly SVG/canvas rendering, which jsdom can't do
// meaningfully and which isn't what this test is about — swap in a stub that
// just exposes the trace names it was asked to draw, so we can assert on
// whether the tide trace is included without exercising Plotly itself.
let lastPlotProps = null;
jest.mock('react-plotly.js/factory', () => () => {
  const MockPlot = (props) => {
    lastPlotProps = props;
    return <div data-testid="mock-plot" />;
  };
  return MockPlot;
});
jest.mock('plotly.js/dist/plotly-basic.min', () => ({}));

import InundationTimeseries from '../InundationTimeseries';

function buildTimeseries() {
  const base = new Date('2026-07-15T00:00:00Z').getTime();
  return Array.from({ length: 6 }, (_, i) => ({
    time: new Date(base + i * 3600_000).toISOString(),
    depth_m: i * 0.1,
  }));
}

function buildSeaLevelTimeseries() {
  const base = new Date('2026-07-15T00:00:00Z').getTime();
  return {
    data: {
      timesteps: Array.from({ length: 6 }, (_, i) => ({
        valid_time_utc: new Date(base + i * 3600_000).toISOString(),
        tide_m: 0.5 + i * 0.05,
      })),
    },
  };
}

const categories = [
  { id: 'dry', thresholdM: 0, label: 'Dry', color: '#94a3b4' },
  { id: 'minor', thresholdM: 0.05, label: 'Minor', color: '#38bdf8' },
  { id: 'niu-maximum', thresholdM: 2, label: 'Maximum', color: '#ef4444' },
];

function traceNames() {
  return (lastPlotProps?.data || []).map((trace) => trace.name);
}

describe('InundationTimeseries tide toggle', () => {
  beforeEach(() => {
    lastPlotProps = null;
  });

  test('does not show a tide checkbox when no tide data is available', () => {
    render(
      <InundationTimeseries
        timeseries={buildTimeseries()}
        categories={categories}
        isDarkMode={false}
      />
    );

    expect(screen.queryByText('Show tide')).not.toBeInTheDocument();
    expect(traceNames()).not.toContain('Tide');
  });

  test('shows a tide checkbox, unchecked, when tide data is available — and the chart has no tide trace yet', () => {
    render(
      <InundationTimeseries
        timeseries={buildTimeseries()}
        categories={categories}
        isDarkMode={false}
        seaLevelTimeseries={buildSeaLevelTimeseries()}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Show tide' });
    expect(checkbox).not.toBeChecked();
    expect(traceNames()).not.toContain('Tide');
  });

  test('checking "Show tide" adds the tide trace to the chart', async () => {
    render(
      <InundationTimeseries
        timeseries={buildTimeseries()}
        categories={categories}
        isDarkMode={false}
        seaLevelTimeseries={buildSeaLevelTimeseries()}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Show tide' });
    await userEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(traceNames()).toContain('Tide');
  });
});
