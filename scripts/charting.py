"""Chart and visualization helpers."""

from __future__ import annotations

import matplotlib.pyplot as plt
import pandas as pd

from .io_utils import resolve_path


def plot_velocity_cycle_time(
    data_filename: str,
    output_filename: str,
    *,
    plt_module=None,
) -> None:
    data_path = resolve_path(data_filename)
    output_path = resolve_path(output_filename)

    df = pd.read_csv(data_path)
    df = df.sort_values(by="CompletedDate")

    sprints = df["Name"]
    velocity = df["CompletedStoryPoints"]
    cycle_time = df["AverageCycleTime"]

    plt_mod = plt_module or plt

    fig, ax1 = plt_mod.subplots(figsize=(8, 5))
    ax2 = ax1.twinx()

    ax1.bar(sprints, velocity, width=0.4, color="#1f77b4", label="Velocity (Story Points)")
    ax1.set_ylabel("Velocity (Story Points)", color="#1f77b4")
    ax1.set_xlabel("Sprint")
    ax1.tick_params(axis="x", rotation=90)
    ax1.set_ylim(0, max(velocity) * 1.15 if len(velocity) else 1)

    ax2.plot(sprints, cycle_time, color="#d62728", marker="o", linewidth=3, label="Avg Cycle Time (days)")
    ax2.set_ylabel("Avg Cycle Time (days)", color="#d62728")
    ax2.set_ylim(0, max(cycle_time) * 1.25 if len(cycle_time) else 1)

    ax1.set_title("Sprint Velocity & Cycle Time")
    fig.tight_layout()
    fig.legend(loc="upper right", bbox_to_anchor=(1, 1), bbox_transform=ax1.transAxes)
    plt_mod.savefig(output_path)
