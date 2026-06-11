import {
  baselineInsightSpecs,
  buildStarterInsightSpecs,
  customEventInsightSpec,
  MAX_CUSTOM_EVENT_INSIGHTS,
  tileLayoutForIndex,
} from '@lib/dashboards/insight-specs';

describe('baselineInsightSpecs', () => {
  it('emits two TrendsQuery insights over all events', () => {
    const [totals, devices] = baselineInsightSpecs();
    expect(totals.name).toBe('Total events');
    expect(totals.query.kind).toBe('TrendsQuery');
    expect(totals.query.interval).toBe('day');
    expect(totals.query.series).toEqual([
      { kind: 'EventsNode', event: null, math: 'total' },
    ]);
    expect(totals.query.dateRange).toEqual({ date_from: '-30d' });

    expect(devices.name).toBe('Active devices');
    expect(devices.query.series[0].math).toBe('unique_device');
    expect(devices.query.series[0].event).toBeNull();
  });
});

describe('customEventInsightSpec', () => {
  it('builds a per-event trends spec with the event name', () => {
    const spec = customEventInsightSpec('button_press');
    expect(spec.name).toBe('button_press');
    expect(spec.query.series).toEqual([
      { kind: 'EventsNode', event: 'button_press', math: 'total' },
    ]);
  });

  it('prefers an explicit label for the title but tracks the real event', () => {
    const spec = customEventInsightSpec('button_press', 'Button presses');
    expect(spec.name).toBe('Button presses');
    expect(spec.query.series[0].event).toBe('button_press');
  });
});

describe('buildStarterInsightSpecs', () => {
  it('prepends the baseline before custom events', () => {
    const specs = buildStarterInsightSpecs([{ name: 'temp_reading' }]);
    expect(specs.map((s) => s.name)).toEqual([
      'Total events',
      'Active devices',
      'temp_reading',
    ]);
  });

  it('dedupes custom events case-insensitively and skips blanks', () => {
    const specs = buildStarterInsightSpecs([
      { name: 'boot' },
      { name: 'BOOT' },
      { name: '  ' },
      { name: 'boot' },
    ]);
    expect(specs.map((s) => s.name)).toEqual([
      'Total events',
      'Active devices',
      'boot',
    ]);
  });

  it('caps the number of custom event insights', () => {
    const many = Array.from(
      { length: MAX_CUSTOM_EVENT_INSIGHTS + 5 },
      (_, i) => ({
        name: `event_${i}`,
      }),
    );
    const specs = buildStarterInsightSpecs(many);
    expect(specs).toHaveLength(2 + MAX_CUSTOM_EVENT_INSIGHTS);
  });

  it('returns baseline-only for no events', () => {
    expect(buildStarterInsightSpecs([])).toHaveLength(2);
  });
});

describe('tileLayoutForIndex', () => {
  it('lays tiles out in a 2-column grid', () => {
    expect(tileLayoutForIndex(0).sm).toMatchObject({ x: 0, y: 0, w: 6, h: 5 });
    expect(tileLayoutForIndex(1).sm).toMatchObject({ x: 6, y: 0 });
    expect(tileLayoutForIndex(2).sm).toMatchObject({ x: 0, y: 5 });
    expect(tileLayoutForIndex(3).sm).toMatchObject({ x: 6, y: 5 });
  });
});
