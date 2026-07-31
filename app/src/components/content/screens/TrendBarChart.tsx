import { useEffect, useMemo, useRef } from "react";
import * as ChartModule from "chart.js/auto";
import type { Chart as ChartInstance, ChartConfiguration, Plugin } from "chart.js";

export type TrendBarChartPoint = {
  label: string;
  tooltipLabel: string;
  value: number;
  valueLabel: string;
  isActive: boolean;
};

type TrendBarChartProps = {
  ariaLabel: string;
  points: TrendBarChartPoint[];
  axisMax: number;
  axisStepSize: number;
  formatYAxisTick: (value: number) => string;
  showValueLabels: boolean;
  showActiveSprintMarker: boolean;
  showTargetLine?: boolean;
  targetValue?: number;
  valueLabelColor?: string;
  barColor?: string;
  barBorderColor?: string;
  activeTickColor?: string;
  activeMarkerSymbol?: string;
  targetLineColor?: string;
  canvasTestId?: string;
};

const DEFAULT_BAR_COLOR = "#3a84dc";
const DEFAULT_BAR_BORDER_COLOR = "#1f67c1";
const DEFAULT_ACTIVE_TICK_COLOR = "#1f8f63";
const DEFAULT_TARGET_LINE_COLOR = "#d97706";
const CHART_BOUNDARY_COLOR = "#bfd0e8";
const AXIS_LABEL_COLOR = "#2a456d";
const VALUE_LABEL_COLOR = "#1f8f63";
const ANGLED_TICK_ROTATION = 38;

type ChartConstructor = new (
  item: HTMLCanvasElement,
  config: ChartConfiguration<"bar">,
) => ChartInstance<"bar">;

type TargetLinePlugin = Plugin<"bar"> & {
  targetValue: number;
};

const Chart =
  ((ChartModule as unknown as { default?: ChartConstructor }).default ??
    (ChartModule as unknown as ChartConstructor));

function getBarDatasetIndex(chart: { data?: { datasets?: Array<{ type?: string }> } }): number {
  const datasetIndex = chart.data?.datasets?.findIndex((dataset) => dataset.type !== "line") ?? -1;
  return datasetIndex >= 0 ? datasetIndex : 0;
}

function clampLabelPosition(value: number, minimum: number): number {
  return value < minimum ? minimum : value;
}

function shouldAngleXAxisLabels(labels: string[]): boolean {
  return labels.some((label) => label.trim().length > 12);
}

function createChartBoundaryPlugin(): Plugin<"bar"> {
  return {
    id: "tbChartBoundary",
    afterDraw(chart) {
      const { chartArea, ctx } = chart;
      if (!chartArea) return;

      ctx.save();
      ctx.strokeStyle = CHART_BOUNDARY_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, chartArea.top);
      ctx.lineTo(chartArea.right, chartArea.top);
      ctx.lineTo(chartArea.right, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

function createValueLabelsPlugin(
  valueLabels: string[],
  color: string,
): Plugin<"bar"> {
  return {
    id: "tbTrendValueLabels",
    afterDatasetsDraw(chart) {
      const datasetMeta = chart.getDatasetMeta(getBarDatasetIndex(chart));
      const { chartArea, ctx } = chart;
      if (!datasetMeta || !chartArea) return;

      ctx.save();
      ctx.fillStyle = color;
      ctx.font = "700 12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      datasetMeta.data.forEach((element, index) => {
        const label = valueLabels[index];
        if (!label) return;

        const elementProps = element.getProps(["x", "y", "base"], true) as {
          x: number;
          y: number;
          base: number;
        };
        const labelY = clampLabelPosition(Math.min(elementProps.y, elementProps.base) - 8, chartArea.top + 16);
        ctx.fillText(label, elementProps.x, labelY);
      });

      ctx.restore();
    },
  };
}

function createTargetLinePlugin(targetValue: number, color: string): TargetLinePlugin {
  return {
    id: "tbTargetLine",
    targetValue,
    beforeDatasetsDraw(chart) {
      const { chartArea, ctx } = chart;
      const yScale = chart.scales.y;
      if (!chartArea || !yScale) return;

      const y = yScale.getPixelForValue(targetValue);
      if (!Number.isFinite(y)) return;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.lineCap = "butt";
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.restore();
    },
  };
}

export function TrendBarChart({
  ariaLabel,
  points,
  axisMax,
  axisStepSize,
  formatYAxisTick,
  showValueLabels,
  showActiveSprintMarker,
  showTargetLine = false,
  targetValue,
  valueLabelColor = VALUE_LABEL_COLOR,
  barColor = DEFAULT_BAR_COLOR,
  barBorderColor = DEFAULT_BAR_BORDER_COLOR,
  activeTickColor = DEFAULT_ACTIVE_TICK_COLOR,
  activeMarkerSymbol = "●",
  targetLineColor = DEFAULT_TARGET_LINE_COLOR,
  canvasTestId,
}: TrendBarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const labels = useMemo(() => points.map((point) => point.label), [points]);
  const tooltipLabels = useMemo(() => points.map((point) => point.tooltipLabel), [points]);
  const valueLabels = useMemo(() => points.map((point) => point.valueLabel), [points]);
  const useAngledXAxisLabels = useMemo(() => shouldAngleXAxisLabels(labels), [labels]);

  const plugins = useMemo(
    () => {
      const nextPlugins: Plugin<"bar">[] = [createChartBoundaryPlugin()];
      if (showTargetLine && targetValue !== undefined) {
        nextPlugins.push(createTargetLinePlugin(targetValue, targetLineColor));
      }
      if (showValueLabels) {
        nextPlugins.push(createValueLabelsPlugin(valueLabels, valueLabelColor));
      }
      return nextPlugins;
    },
    [showTargetLine, showValueLabels, targetLineColor, targetValue, valueLabelColor, valueLabels],
  );

  const config = useMemo(() => {
    const datasets: any[] = [
      {
        type: "bar",
        data: points.map((point) => point.value),
        backgroundColor: barColor,
        borderColor: barBorderColor,
        borderWidth: 1,
        categoryPercentage: 0.72,
        barPercentage: 0.32,
        maxBarThickness: 14,
        order: 2,
      },
    ];

    return {
      type: "bar" as const,
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        layout: {
          padding: {
            top: showValueLabels ? 18 : 10,
            right: 14,
            bottom: 4,
            left: 4,
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            displayColors: false,
            filter: (tooltipItem: any) => tooltipItem.datasetIndex === 0,
            callbacks: {
              title: () => "",
              label: (tooltipItem: any) => tooltipLabels[tooltipItem.dataIndex] ?? "",
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawTicks: false,
            },
            border: {
              display: true,
              color: CHART_BOUNDARY_COLOR,
              width: 2,
            },
            ticks: {
              autoSkip: false,
              minRotation: useAngledXAxisLabels ? ANGLED_TICK_ROTATION : 0,
              maxRotation: useAngledXAxisLabels ? ANGLED_TICK_ROTATION : 0,
              color: (context: any) => (
                showActiveSprintMarker && points[context.index]?.isActive
                  ? activeTickColor
                  : AXIS_LABEL_COLOR
              ),
              font: () => ({
                size: 11,
                weight: "700",
              }),
              padding: useAngledXAxisLabels ? 4 : 10,
              callback: (_value: unknown, index: number) => {
                const point = points[index];
                if (!point) return "";
                if (showActiveSprintMarker && point.isActive) {
                  return [point.label, activeMarkerSymbol];
                }
                return point.label;
              },
            },
          },
          y: {
            beginAtZero: true,
            min: 0,
            max: axisMax,
            ticks: {
              stepSize: axisStepSize,
              color: AXIS_LABEL_COLOR,
              font: {
                size: 11,
                weight: "700",
              },
              padding: 8,
              callback: (value: unknown) => formatYAxisTick(Number(value)),
            },
            grid: {
              display: false,
              drawTicks: true,
              tickColor: CHART_BOUNDARY_COLOR,
              tickLength: 6,
              tickWidth: 2,
            },
            border: {
              display: true,
              color: CHART_BOUNDARY_COLOR,
              width: 2,
            },
          },
        },
      },
      plugins,
    };
  }, [
    activeMarkerSymbol,
    activeTickColor,
    axisMax,
    axisStepSize,
    barBorderColor,
    barColor,
    formatYAxisTick,
    labels,
    plugins,
    points,
    showActiveSprintMarker,
    useAngledXAxisLabels,
    showValueLabels,
    tooltipLabels,
  ]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const chart = new Chart(canvasRef.current, config as any);
    return () => {
      chart.destroy();
    };
  }, [config]);

  return (
    <div className="tb-trend-chart">
      <canvas
        ref={canvasRef}
        className="tb-trend-chart-canvas"
        role="img"
        aria-label={ariaLabel}
        data-testid={canvasTestId}
      >
        {ariaLabel}
      </canvas>
    </div>
  );
}
