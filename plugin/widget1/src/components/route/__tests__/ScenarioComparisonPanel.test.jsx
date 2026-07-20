import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScenarioComparisonPanel from '../ScenarioComparisonPanel';
import { createScenario } from '../../../services/scenarioService';

// exportSuitabilityPDF dynamically imports jspdf internally — mock it at the
// module boundary so component tests don't need a real PDF engine in jsdom.
jest.mock('../../../utils/SuitabilityPDFExporter', () => ({
  exportSuitabilityPDF: jest.fn().mockResolvedValue('brief.pdf'),
}));

// eslint-disable-next-line import/first
import { exportSuitabilityPDF } from '../../../utils/SuitabilityPDFExporter';

// @testing-library/user-event v13 (this repo's pinned version) has no
// userEvent.setup() — that's a v14 API. Call the methods directly instead.

const ROUTE_POINTS = [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }];

function routeResult(overrides = {}) {
  return {
    vessel: 'small_craft',
    departure_time: '2026-07-09T12:00:00Z',
    speed_kt: 8,
    summary: {
      distance_nm: 10, duration_hours: 1.25,
      worst_hazard_class: 0, recommendation: 'Suitable',
      suitable_percent: 100, caution_percent: 0, warning_percent: 0,
    },
    samples: [{ sample_index: 0, hazard_class: 0, eta: '2026-07-09T12:00:00Z', wind_speed_kt: 5, wave_height_m: 0.3, available: true }],
    segments: [],
    ...overrides,
  };
}

function readyScenario(name, overrides = {}) {
  const scenario = createScenario({ name, vessel: 'small_craft', routePoints: ROUTE_POINTS, departureTime: '2026-07-09T12:00', speedKt: 8 });
  return { ...scenario, status: 'ready', forecastResult: routeResult(overrides.result), ...overrides };
}

const currentInputs = { vessel: 'small_craft', routePoints: ROUTE_POINTS, departureTime: '2026-07-09T12:00', speedKt: 8 };

function findCard(container, name) {
  return Array.from(container.querySelectorAll('.scenario-card')).find((el) => el.textContent.includes(name));
}

beforeEach(() => {
  exportSuitabilityPDF.mockClear();
});

describe('ScenarioComparisonPanel', () => {
  test('"Save current" is enabled once at least two route points exist, and calls onSaveCurrent', async () => {
    const onSaveCurrent = jest.fn();
    render(
      <ScenarioComparisonPanel
        scenarios={[]}
        currentInputs={currentInputs}
        onSaveCurrent={onSaveCurrent}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    const saveBtn = screen.getByRole('button', { name: 'Save current' });
    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);
    expect(onSaveCurrent).toHaveBeenCalledTimes(1);
  });

  test('"Save current" is disabled with fewer than two route points', () => {
    render(
      <ScenarioComparisonPanel
        scenarios={[]}
        currentInputs={{ ...currentInputs, routePoints: [ROUTE_POINTS[0]] }}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save current' })).toBeDisabled();
  });

  test('duplicating a scenario card calls onDuplicate with its id', async () => {
    const onDuplicate = jest.fn();
    const scenario = readyScenario('Scenario A');
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={onDuplicate}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Duplicate/i }));
    expect(onDuplicate).toHaveBeenCalledWith(scenario.id);
  });

  test('running one scenario calls onRun with its id; "Run all" calls onRunAll', async () => {
    const onRun = jest.fn();
    const onRunAll = jest.fn();
    const scenario = readyScenario('Scenario A');
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={onRun}
        onRunAll={onRunAll}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Run$/i }));
    expect(onRun).toHaveBeenCalledWith(scenario.id);

    await userEvent.click(screen.getByRole('button', { name: /Run all/i }));
    expect(onRunAll).toHaveBeenCalledTimes(1);
  });

  test('removing a scenario calls onRemove with its id', async () => {
    const onRemove = jest.fn();
    const scenario = readyScenario('Scenario A');
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={onRemove}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: `Remove ${scenario.name}` }));
    expect(onRemove).toHaveBeenCalledWith(scenario.id);
  });

  test('the lowest-hazard ready scenario is marked Recommended', () => {
    const good = readyScenario('Scenario A', { result: routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 0, recommendation: 'Suitable', suitable_percent: 100, caution_percent: 0, warning_percent: 0 },
    }) });
    const bad = readyScenario('Scenario B', { result: routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
    }) });

    const { container } = render(
      <ScenarioComparisonPanel
        scenarios={[bad, good]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    const goodCard = findCard(container, 'Scenario A');
    const badCard = findCard(container, 'Scenario B');
    expect(within(goodCard).getByText('Recommended')).toBeInTheDocument();
    expect(within(badCard).queryByText('Recommended')).not.toBeInTheDocument();
  });

  test('shows a re-run banner when the live route points no longer match a ready scenario', () => {
    const scenario = readyScenario('Scenario A');
    const movedRoutePoints = [{ lon: -169.9, lat: -19.1 }, { lon: -169.5, lat: -18.8 }];
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={{ ...currentInputs, routePoints: movedRoutePoints }}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.getByText(/re-run recommended/i)).toBeInTheDocument();
  });

  test('does not show a re-run banner when live route points still match', () => {
    const scenario = readyScenario('Scenario A');
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.queryByText(/re-run recommended/i)).not.toBeInTheDocument();
  });

  test('does not show a re-run banner merely because the scenario vessel/speed/departure differs from the live form', () => {
    // Scenarios are meant to vary from the live form along vessel/speed/departure
    // by design (that's the point of comparing them) — only a route-points change
    // should mark a scenario as stale. Regression test for the isScenarioStale ->
    // isScenarioRouteStale fix.
    const scenario = readyScenario('Scenario A');
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={{ ...currentInputs, vessel: 'traditional_craft', speedKt: 12, departureTime: '2026-07-09T18:00' }}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.queryByText(/re-run recommended/i)).not.toBeInTheDocument();
  });

  test('shows a superseded banner when a newer model run is detected', () => {
    const scenario = { ...readyScenario('Scenario A'), modelRunStartAtRun: '2026-07-09T00:00:00Z' };
    render(
      <ScenarioComparisonPanel
        scenarios={[scenario]}
        currentInputs={currentInputs}
        currentModelRunStart="2026-07-09T06:00:00Z"
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.getByText(/superseded by a newer forecast/i)).toBeInTheDocument();
  });

  test('the compare table and brief button only appear once at least two scenarios are ready', () => {
    const single = readyScenario('Scenario A');
    const { rerender } = render(
      <ScenarioComparisonPanel
        scenarios={[single]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const second = readyScenario('Scenario B');
    rerender(
      <ScenarioComparisonPanel
        scenarios={[single, second]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Scenario Comparison Brief/i })).toBeInTheDocument();
  });

  test('generating the comparison brief calls exportSuitabilityPDF with a scenario_comparison advisoryConfig', async () => {
    const a = readyScenario('Scenario A');
    const b = readyScenario('Scenario B');
    render(
      <ScenarioComparisonPanel
        scenarios={[a, b]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    // The click handler's own async chain (export → finally setState) must
    // resolve inside the same act() the click is wrapped in, or React warns
    // about the later setState landing outside act().
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Generate Scenario Comparison Brief/i }));
    });

    expect(exportSuitabilityPDF).toHaveBeenCalledTimes(1);
    const [{ advisoryConfig }] = exportSuitabilityPDF.mock.calls[0];
    expect(advisoryConfig.area.type).toBe('scenario_comparison');
    expect(advisoryConfig.scenarioComparison.scenarios).toHaveLength(2);
  });

  // Home.jsx's handleSaveDepartureSuggestionAsScenario (and the equivalent
  // "confirm a suggestion" flows) build a scenario object directly with
  // status: 'ready' + forecastResult already set, deliberately bypassing
  // runScenario since the result was already fetched by findBetterDeparture
  // — a new way for a scenario to reach "ready" that doesn't exist anywhere
  // else. This confirms the panel treats it identically to a scenario that
  // went through runScenario.
  test('a scenario saved via the "already fetched, skip runScenario" shortcut ranks and renders like any other', () => {
    const now = new Date().toISOString();
    const viaShortcut = {
      ...createScenario({ name: 'Scenario A', vessel: 'small_craft', routePoints: ROUTE_POINTS, departureTime: '2026-07-09T18:00', speedKt: 8 }),
      status: 'ready',
      forecastResult: routeResult({
        summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 0, recommendation: 'Suitable', suitable_percent: 100, caution_percent: 0, warning_percent: 0 },
      }),
      updatedAt: now,
      generatedAt: now,
      modelRunStartAtRun: '2026-07-09T00:00:00Z',
    };
    const viaRunScenario = readyScenario('Scenario B', { result: routeResult({
      summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
    }) });

    const { container } = render(
      <ScenarioComparisonPanel
        scenarios={[viaShortcut, viaRunScenario]}
        currentInputs={currentInputs}
        onSaveCurrent={jest.fn()}
        onDuplicate={jest.fn()}
        onRemove={jest.fn()}
        onRun={jest.fn()}
        onRunAll={jest.fn()}
      />,
    );

    // Renders like a normal scenario card, and — since its hazard is
    // better — is the one ranked Recommended.
    const shortcutCard = findCard(container, 'Scenario A');
    expect(within(shortcutCard).getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
