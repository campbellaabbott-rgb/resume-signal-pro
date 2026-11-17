/**
 * A TREND CARD THAT COULD NOT READ IS NOT A HUNDRED PERCENT (S14X-156).
 *
 * WHAT WAS WRONG. The Email Delivery, Webhooks and AI Generation cards on
 * /health-check each caught their reader's error, logged it to the console and
 * rendered as if the window were empty: "0" in the total and "100.0%" in
 * Success, coloured green. A wrong admin key or admin-ops answering 502 read
 * as a perfect day, and so did a window with nothing in it: no sends is not a
 * 100% success rate.
 *
 * WHAT HOLDS NOW, by rendering each real card with its reader faked:
 *   - a reader that refuses or throws puts the page's "Unavailable" panel, with
 *     the reason, where the numbers and the chart were, and no rate at all;
 *   - an empty window prints a dash for the rate and the average time, and the
 *     card's quiet state;
 *   - a window with rows prints the rate those rows give;
 *   - a later read that answers clears the unavailable state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const adminRpc = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ adminRpc: (...a: unknown[]) => adminRpc(...a) }));
// Recharts measures its container; jsdom has no layout, so the chart is a stub.
vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div data-chart="true">{children}</div>;
  return { ResponsiveContainer: Stub, AreaChart: Stub, Area: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null };
});

import { EmailTrendChart } from "@/components/dashboard/EmailTrendChart";
import { WebhookTrendChart } from "@/components/dashboard/WebhookTrendChart";
import { AIGenerationTrendChart } from "@/components/dashboard/AIGenerationTrendChart";

const hour = (h: number) => new Date(Date.UTC(2026, 10, 17, h)).toISOString();

const CARDS = [
  {
    name: "Email Delivery", Card: EmailTrendChart, fn: "get_email_metrics_hourly", quiet: /No emails sent/,
    rows: [{ hour_bucket: hour(1), total_emails: 8, successful_emails: 7, failed_emails: 1, success_rate: 87.5 },
      { hour_bucket: hour(2), total_emails: 2, successful_emails: 2, failed_emails: 0, success_rate: 100 }],
  },
  {
    name: "Webhooks", Card: WebhookTrendChart, fn: "get_webhook_metrics_hourly", quiet: /No webhooks received/,
    rows: [{ hour_bucket: hour(1), total_webhooks: 8, successful_webhooks: 7, failed_webhooks: 1, avg_processing_time_ms: 120, success_rate: 87.5 },
      { hour_bucket: hour(2), total_webhooks: 2, successful_webhooks: 2, failed_webhooks: 0, avg_processing_time_ms: 80, success_rate: 100 }],
  },
  {
    name: "AI Generation", Card: AIGenerationTrendChart, fn: "get_ai_generation_metrics_hourly", quiet: /No AI generations/,
    rows: [{ hour_bucket: hour(1), total_generations: 8, successful_generations: 7, failed_generations: 1, avg_duration_ms: 20000, success_rate: 87.5 },
      { hour_bucket: hour(2), total_generations: 2, successful_generations: 2, failed_generations: 0, avg_duration_ms: 10000, success_rate: 100 }],
  },
] as const;

const unavailable = () => document.querySelector('[data-panel-unavailable="true"]');

beforeEach(() => { adminRpc.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each(CARDS)("the $name card", ({ Card, fn, quiet, rows }) => {
  it("a reader that refuses shows Unavailable with the reason, and no rate", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "Unauthorized" } });
    render(<Card />);
    await waitFor(() => expect(unavailable()).toBeTruthy());
    expect(adminRpc).toHaveBeenCalledWith(fn, { p_hours_back: 24 });
    expect(unavailable()!.textContent).toMatch(/Unavailable: this panel's reader did not answer \(Unauthorized\)/);
    expect(document.body.textContent).not.toMatch(/100\.0%/);
    expect(document.body.textContent).not.toMatch(/\d%/);
    expect(screen.queryByText(quiet)).toBeNull();
  });

  it("a reader that throws (admin-ops 502) is unavailable too", async () => {
    adminRpc.mockRejectedValue(new Error("Edge Function returned a non-2xx status code"));
    render(<Card />);
    await waitFor(() => expect(unavailable()).toBeTruthy());
    expect(unavailable()!.textContent).toMatch(/non-2xx/);
    expect(document.body.textContent).not.toMatch(/100\.0%/);
  });

  it("an empty window prints a dash for the rate, not 100.0%, and the quiet state", async () => {
    adminRpc.mockResolvedValue({ data: [], error: null });
    render(<Card />);
    await waitFor(() => expect(screen.getByText(quiet)).toBeTruthy());
    expect(unavailable()).toBeNull();
    expect(document.body.textContent).not.toMatch(/100\.0%/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("a window with rows prints the rate those rows give", async () => {
    adminRpc.mockResolvedValue({ data: rows, error: null });
    render(<Card />);
    await waitFor(() => expect(screen.getByText("90.0%")).toBeTruthy());
    expect(screen.getByText("10")).toBeTruthy();
    expect(unavailable()).toBeNull();
  });

  it("a later read that answers clears the unavailable state", async () => {
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: "Unauthorized" } });
    adminRpc.mockResolvedValue({ data: rows, error: null });
    render(<Card />);
    await waitFor(() => expect(unavailable()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() => expect(screen.getByText("90.0%")).toBeTruthy());
    expect(unavailable()).toBeNull();
  });
});
