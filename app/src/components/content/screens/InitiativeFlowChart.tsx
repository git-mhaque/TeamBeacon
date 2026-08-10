import { useEffect, useMemo, useRef } from "react";
import ChartModule from "chart.js/auto";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";
import type { InitiativeDeepDiveWeeklyBucket } from "../../../lib/api";

type Props = {
  buckets: InitiativeDeepDiveWeeklyBucket[];
};

type ChartConstructor = new (
  item: HTMLCanvasElement,
  config: ChartConfiguration<"bar">,
) => ChartInstance<"bar">;

const Chart = ChartModule as unknown as ChartConstructor;

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatWeekLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(parseLocalDate(value));
}

function formatTooltipRange(bucket: InitiativeDeepDiveWeeklyBucket): string {
  const formatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${formatter.format(parseLocalDate(bucket.weekStart))} – ${formatter.format(parseLocalDate(bucket.weekEnd))}`;
}

export function InitiativeFlowChart({ buckets }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labels = useMemo(() => buckets.map((bucket) => formatWeekLabel(bucket.weekStart)), [buckets]);

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "New cards",
            data: buckets.map((bucket) => bucket.newCount),
            backgroundColor: "#d97706",
            borderColor: "#9a4d00",
            borderWidth: 1,
            borderRadius: 3,
            categoryPercentage: 0.72,
            barPercentage: 0.84,
            maxBarThickness: 24,
          },
          {
            label: "Completed cards",
            data: buckets.map((bucket) => bucket.completedCount),
            backgroundColor: "#2f9d72",
            borderColor: "#187653",
            borderWidth: 1,
            borderRadius: 3,
            categoryPercentage: 0.72,
            barPercentage: 0.84,
            maxBarThickness: 24,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        interaction: {
          mode: "index",
          intersect: false,
        },
        layout: {
          padding: { top: 10, right: 14, bottom: 2, left: 4 },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              color: "#2a456d",
              font: { family: "system-ui", size: 12, weight: 600 },
              useBorderRadius: true,
              borderRadius: 3,
            },
          },
          tooltip: {
            displayColors: true,
            callbacks: {
              title: (items) => {
                const index = items[0]?.dataIndex ?? 0;
                return buckets[index] ? formatTooltipRange(buckets[index]) : "";
              },
              afterBody: (items) => {
                const index = items[0]?.dataIndex ?? 0;
                const bucket = buckets[index];
                if (!bucket) return "";
                const sign = bucket.netFlow > 0 ? "+" : "";
                return `Net flow: ${sign}${bucket.netFlow}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: "#bfd0e8" },
            title: {
              display: true,
              text: "Week starting",
              color: "#5d6b82",
              font: { family: "system-ui", size: 12, weight: 600 },
            },
            ticks: {
              color: "#5d6b82",
              font: { family: "system-ui", size: 11, weight: 500 },
              maxRotation: 0,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            grace: "10%",
            grid: { color: "rgba(125, 147, 177, 0.18)" },
            border: { display: false },
            title: {
              display: true,
              text: "Card count",
              color: "#5d6b82",
              font: { family: "system-ui", size: 12, weight: 600 },
            },
            ticks: {
              color: "#5d6b82",
              precision: 0,
              stepSize: 1,
              font: { family: "system-ui", size: 11 },
            },
          },
        },
      },
    });

    return () => {
      chart.destroy();
    };
  }, [buckets, labels]);

  return (
    <div className="tb-initiative-flow-chart">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="New and completed cards by week"
        data-testid="initiative-flow-chart"
      />
    </div>
  );
}
