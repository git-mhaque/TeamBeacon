import { render } from "@testing-library/preact";
import { vi } from "vitest";
import { TrendBarChart } from "../../src/components/content/screens/TrendBarChart";

type MockChartCall = {
  canvas: HTMLCanvasElement;
  config: any;
  destroy: ReturnType<typeof vi.fn>;
};

const { chartCalls } = vi.hoisted(() => ({
  chartCalls: [] as MockChartCall[],
}));

vi.mock("chart.js/auto", () => {
  const Chart = vi.fn(function MockChart(this: unknown, canvas: HTMLCanvasElement, config: any) {
    const chartCall: MockChartCall = {
      canvas,
      config,
      destroy: vi.fn(),
    };
    chartCalls.push(chartCall);
    return chartCall;
  });

  return {
    default: Chart,
  };
});

function getLatestChartCall(): MockChartCall {
  expect(chartCalls.length).toBeGreaterThan(0);
  return chartCalls[chartCalls.length - 1];
}

function getTargetLinePlugin(chartCall: MockChartCall): any | undefined {
  return chartCall.config.plugins.find((plugin: { id?: string }) => plugin.id === "tbTargetLine");
}

describe("TrendBarChart", () => {
  beforeEach(() => {
    chartCalls.length = 0;
  });

  it("builds chart config with target line, active marker, tooltip callbacks, and plugins", () => {
    render(
      <TrendBarChart
        ariaLabel="Cycle chart"
        points={[
          {
            label: "Sprint 1",
            tooltipLabel: "From 01-Jan-2026 to 14-Jan-2026",
            value: 4.2,
            valueLabel: "4.2 d",
            isActive: false,
          },
          {
            label: "Sprint 2",
            tooltipLabel: "From 15-Jan-2026 to 28-Jan-2026",
            value: 5.1,
            valueLabel: "5.1 d",
            isActive: true,
          },
        ]}
        axisMax={8}
        axisStepSize={2}
        formatYAxisTick={(value) => `${value} d`}
        showValueLabels={true}
        showActiveSprintMarker={true}
        showTargetLine={true}
        targetValue={5}
      />
    );

    const chartCall = getLatestChartCall();
    expect(chartCall.canvas.getAttribute("aria-label")).toBe("Cycle chart");
    expect(chartCall.config.data.labels).toEqual(["Sprint 1", "Sprint 2"]);
    expect(chartCall.config.data.datasets).toHaveLength(1);
    expect(chartCall.config.data.datasets[0].type).toBe("bar");
    expect(chartCall.config.data.datasets[0].data).toEqual([4.2, 5.1]);
    expect(chartCall.config.options.plugins.tooltip.filter({ datasetIndex: 0 })).toBe(true);
    expect(chartCall.config.options.plugins.tooltip.filter({ datasetIndex: 1 })).toBe(false);
    expect(chartCall.config.options.plugins.tooltip.callbacks.title()).toBe("");
    expect(chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex: 1 })).toBe(
      "From 15-Jan-2026 to 28-Jan-2026"
    );
    expect(chartCall.config.options.scales.x.ticks.callback(undefined, 1)).toEqual(["Sprint 2", "●"]);
    expect(chartCall.config.options.scales.x.ticks.color({ index: 1 })).toBe("#1f8f63");
    expect(chartCall.config.options.scales.y.ticks.callback(6)).toBe("6 d");

    const boundaryPlugin = chartCall.config.plugins.find((plugin: { id?: string }) => plugin.id === "tbChartBoundary");
    const targetLinePlugin = getTargetLinePlugin(chartCall);
    const valueLabelsPlugin = chartCall.config.plugins.find((plugin: { id?: string }) => plugin.id === "tbTrendValueLabels");
    expect(boundaryPlugin).toBeDefined();
    expect(targetLinePlugin).toBeDefined();
    expect(targetLinePlugin.targetValue).toBe(5);
    expect(valueLabelsPlugin).toBeDefined();

    const boundaryContext = {
      save: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      restore: vi.fn(),
    };
    boundaryPlugin.afterDraw({
      chartArea: { left: 10, top: 20, right: 110, bottom: 220 },
      ctx: boundaryContext,
    });
    expect(boundaryContext.moveTo).toHaveBeenCalledWith(10, 20);
    expect(boundaryContext.lineTo).toHaveBeenCalledWith(110, 20);
    expect(boundaryContext.lineTo).toHaveBeenCalledWith(110, 220);
    expect(boundaryContext.stroke).toHaveBeenCalled();

    const targetLineContext = {
      save: vi.fn(),
      setLineDash: vi.fn(),
      lineWidth: 0,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      restore: vi.fn(),
    };
    targetLinePlugin.beforeDatasetsDraw({
      chartArea: { left: 10, right: 110 },
      scales: {
        y: {
          getPixelForValue: vi.fn(() => 85),
        },
      },
      ctx: targetLineContext,
    });
    expect(targetLineContext.setLineDash).toHaveBeenCalledWith([8, 4]);
    expect(targetLineContext.lineWidth).toBe(1.25);
    expect(targetLineContext.moveTo).toHaveBeenCalledWith(10, 85);
    expect(targetLineContext.lineTo).toHaveBeenCalledWith(110, 85);
    expect(targetLineContext.stroke).toHaveBeenCalled();

    const labelContext = {
      save: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
    };
    valueLabelsPlugin.afterDatasetsDraw({
      data: {
        datasets: [{ type: "bar" }],
      },
      getDatasetMeta: () => ({
        data: [
          { getProps: () => ({ x: 25, y: 40, base: 200 }) },
          { getProps: () => ({ x: 75, y: 30, base: 200 }) },
        ],
      }),
      chartArea: { top: 12 },
      ctx: labelContext,
    });
    expect(labelContext.fillText).toHaveBeenCalledWith("4.2 d", 25, 32);
    expect(labelContext.fillText).toHaveBeenCalledWith("5.1 d", 75, 28);
    expect(labelContext.restore).toHaveBeenCalled();
  });

  it("omits optional helpers when target line, value labels, and active marker are disabled", () => {
    render(
      <TrendBarChart
        ariaLabel="Story points chart"
        points={[
          {
            label: "Sprint 1",
            tooltipLabel: "From - to -",
            value: 0,
            valueLabel: "0 SP",
            isActive: false,
          },
        ]}
        axisMax={4}
        axisStepSize={1}
        formatYAxisTick={(value) => `${value} SP`}
        showValueLabels={false}
        showActiveSprintMarker={false}
        showTargetLine={false}
      />
    );

    const chartCall = getLatestChartCall();
    expect(chartCall.config.data.datasets).toHaveLength(1);
    expect(chartCall.config.options.scales.x.ticks.callback(undefined, 0)).toBe("Sprint 1");
    expect(chartCall.config.options.scales.x.ticks.callback(undefined, 99)).toBe("");
    expect(chartCall.config.options.scales.x.ticks.color({ index: 0 })).toBe("#2a456d");
    expect(getTargetLinePlugin(chartCall)).toBeUndefined();
    expect(
      chartCall.config.plugins.some((plugin: { id?: string }) => plugin.id === "tbTrendValueLabels")
    ).toBe(false);

    const boundaryPlugin = chartCall.config.plugins.find((plugin: { id?: string }) => plugin.id === "tbChartBoundary");
    const noAreaContext = {
      save: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      restore: vi.fn(),
    };
    boundaryPlugin.afterDraw({
      chartArea: null,
      ctx: noAreaContext,
    });
    expect(noAreaContext.stroke).not.toHaveBeenCalled();
  });
});
