import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RouteForecastPanel from '../RouteForecastPanel';
import { MAX_SCENARIOS } from '../../../services/scenarioService';

jest.mock('../../../utils/SuitabilityPDFExporter', () => ({
  exportSuitabilityPDF: jest.fn().mockResolvedValue('brief.pdf'),
}));

function sample(overrides = {}) {
  return {
    sample_index: 0,
    lon: -169.9,
    lat: -19.1,
    distance_nm: 0,
    eta: '2026-07-09T12:00:00Z',
    hazard_class: 0,
    hazard_label: 'Suitable',
    wave_height_m: 0.3,
    wind_speed_kt: 5,
    available: true,
    ...overrides,
  };
}

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
    samples: [sample()],
    segments: [],
    ...overrides,
  };
}

const routePoints = [{ lon: -169.9, lat: -19.1 }, { lon: -169.8, lat: -19.0 }];

function baseData(overrides = {}) {
  return {
    result: routeResult(),
    selectedVessel: 'small_craft',
    routePoints,
    speedKt: 8,
    departureTime: '2026-07-09T12:00:00Z',
    generatedAt: '2026-07-09T12:05:00Z',
    ...overrides,
  };
}

describe('RouteForecastPanel — vessel suggestion (Feature A)', () => {
  test('hides the suggestion when the current vessel is already Suitable', () => {
    render(<RouteForecastPanel data={baseData()} />);
    expect(screen.queryByText(/Confirm & compare/i)).not.toBeInTheDocument();
  });

  test('shows the suggestion and confirms it via onConfirmVesselSuggestion when hazard is elevated', async () => {
    const onConfirmVesselSuggestion = jest.fn().mockResolvedValue(undefined);
    const data = baseData({
      selectedVessel: 'traditional_craft',
      result: routeResult({
        summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
        samples: [sample({ hazard_class: 2, wind_speed_kt: 13, wave_height_m: 0 })],
      }),
    });

    render(<RouteForecastPanel data={data} scenarioCount={0} onConfirmVesselSuggestion={onConfirmVesselSuggestion} />);

    const confirmBtn = screen.getByRole('button', { name: /Confirm & compare/i });
    expect(confirmBtn).toBeEnabled();
    // The click handler's own async chain (confirm -> finally setState) must
    // resolve inside the same act() the click is wrapped in.
    await act(async () => { await userEvent.click(confirmBtn); });
    expect(onConfirmVesselSuggestion).toHaveBeenCalledWith('very_small_motorised_craft');
  });

  test('disables the confirm button once the scenario cap is reached', () => {
    const data = baseData({
      selectedVessel: 'traditional_craft',
      result: routeResult({
        summary: { distance_nm: 10, duration_hours: 1, worst_hazard_class: 2, recommendation: 'Avoid', suitable_percent: 0, caution_percent: 0, warning_percent: 100 },
        samples: [sample({ hazard_class: 2, wind_speed_kt: 13, wave_height_m: 0 })],
      }),
    });

    render(<RouteForecastPanel data={data} scenarioCount={MAX_SCENARIOS} onConfirmVesselSuggestion={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Confirm & compare/i })).toBeDisabled();
  });
});

describe('RouteForecastPanel — better departure (Feature B)', () => {
  test('shows progress text while checking, driven by departureSuggestionProgress', () => {
    render(
      <RouteForecastPanel
        data={baseData()}
        departureSuggestionLoading
        departureSuggestionProgress={{ offsetHours: 6, index: 1, total: 4 }}
        onSuggestBetterDeparture={jest.fn()}
      />,
    );
    expect(screen.getByText(/Checking \+6h/)).toBeInTheDocument();
    expect(screen.getByText(/\(2\/4\)/)).toBeInTheDocument();
  });

  test('renders the confirmed result with Apply / Save as scenario actions', async () => {
    const onApply = jest.fn();
    const onSave = jest.fn();
    render(
      <RouteForecastPanel
        data={baseData()}
        departureSuggestionResult={{ offsetHours: 6, departureTime: '2026-07-09T18:00:00Z', worstHazardClass: 0, allClear: true }}
        onApplyDepartureSuggestion={onApply}
        onSaveDepartureSuggestionAsScenario={onSave}
      />,
    );
    expect(screen.getByText(/checked against the route forecast/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save as scenario' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('shows the departure suggestion error message when present', () => {
    render(<RouteForecastPanel data={baseData()} departureSuggestionError="Could not check alternative departure times." />);
    expect(screen.getByText('Could not check alternative departure times.')).toBeInTheDocument();
  });
});

describe('RouteForecastPanel — loading/error/empty states unaffected by new props', () => {
  test('still shows the loading message when data.loading is true', () => {
    render(<RouteForecastPanel data={{ loading: true }} />);
    expect(screen.getByText(/Running route forecast/i)).toBeInTheDocument();
  });

  test('still shows the empty-state prompt with no result', () => {
    render(<RouteForecastPanel data={{}} />);
    expect(screen.getByText(/Draw or import a route/i)).toBeInTheDocument();
  });
});
