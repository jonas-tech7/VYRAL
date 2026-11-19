"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { cn, compactNumber, dateTimeUtc, price as fmtPrice, signedPct } from "@/lib/format";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Range = "1D" | "1W" | "1M" | "ALL";
type Mode = "line" | "candles";

const RANGES: Range[] = ["1D", "1W", "1M", "ALL"];
const ACCENT = "#2cf59e";
const PRICE_FORMAT = { type: "custom" as const, formatter: (p: number) => fmtPrice(p).replace("$", ""), minMove: 1e-12 };
const NEGATIVE = "#f2555a";

/**
 * Price (top pane) and volume (separate bottom pane — never a second y-axis
 * on the same plot). Line view by default; candles use filled-up / hollow-down
 * bodies so direction never relies on colour alone.
 */
export function PriceChart({ mint, symbol }: { mint: string; symbol: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ price: ISeriesApi<"Area"> | ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const [range, setRange] = useState<Range>("1D");
  const [mode, setMode] = useState<Mode>("line");
  const [data, setData] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [readout, setReadout] = useState<{ time: number; price: number; volume: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tokens/${mint}/candles?range=${range}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { candles: [] }))
      .then((body: { candles: Candle[] }) => {
        if (!cancelled) setData(body.candles);
      })
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mint, range]);

  // (Re)build the chart when the mode changes.
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui",
        fontSize: 11,
        panes: { separatorColor: "#1c1c21", separatorHoverColor: "#2a2a31", enableResize: false },
        // Attribution is shown as a text credit below the chart instead of the in-canvas logo.
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#16161a" } },
      rightPriceScale: { borderColor: "#1c1c21", scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: "#1c1c21", timeVisible: true, secondsVisible: false, rightOffset: 2 },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#52525b", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#17171b" },
        horzLine: { color: "#3f3f46", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#17171b" },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    const priceSeries =
      mode === "line"
        ? chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            lineWidth: 2,
            topColor: "rgba(44,245,158,0.10)",
            bottomColor: "rgba(44,245,158,0.0)",
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: "#050506",
            crosshairMarkerBorderWidth: 2,
            crosshairMarkerBackgroundColor: ACCENT,
            priceFormat: PRICE_FORMAT,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: ACCENT,
            downColor: "rgba(0,0,0,0)",
            borderUpColor: ACCENT,
            borderDownColor: NEGATIVE,
            wickUpColor: ACCENT,
            wickDownColor: NEGATIVE,
            priceLineVisible: false,
            priceFormat: PRICE_FORMAT,
          });
    const volume = chart.addSeries(HistogramSeries, {
        color: "#2a2a31",
        priceFormat: { type: "custom", formatter: (v: number) => `$${compactNumber(v)}`, minMove: 1 },
        priceLineVisible: false,
        lastValueVisible: false,
      }, 1);
    chart.panes()[1]?.setHeight(72);
    chartRef.current = chart;
    seriesRef.current = { price: priceSeries, volume };

    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.time || !p.seriesData.size) return setReadout(null);
      const pd = p.seriesData.get(priceSeries) as { value?: number; close?: number } | undefined;
      const vd = p.seriesData.get(volume) as { value?: number } | undefined;
      setReadout({ time: Number(p.time), price: pd?.value ?? pd?.close ?? 0, volume: vd?.value ?? 0 });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [mode]);

  // Push data into the current series.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !data) return;
    if (mode === "line") {
      (s.price as ISeriesApi<"Area">).setData(data.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    } else {
      (s.price as ISeriesApi<"Candlestick">).setData(
        data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
      );
    }
    s.volume.setData(data.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume })));
    chartRef.current?.timeScale().fitContent();
  }, [data, mode]);

  const last = data && data.length ? data[data.length - 1] : null;
  const first = data && data.length ? data[0] : null;
  const shown = readout ?? (last ? { time: last.time, price: last.close, volume: last.volume } : null);
  const change = first && shown && first.open > 0 ? ((shown.price - first.open) / first.open) * 100 : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <p className="text-[12px] text-ink-3">${symbol} price · {readout ? dateTimeUtc(new Date(readout.time * 1000)) : `${range} range`}</p>
          <p className="mt-1 flex items-baseline gap-2.5">
            <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{shown ? fmtPrice(shown.price) : "—"}</span>
            {change !== null ? <span className={cn("num text-[13px]", change >= 0 ? "text-positive" : "text-negative")}>{signedPct(change)}</span> : null}
            {shown ? <span className="text-[12px] text-ink-3">Vol {"$" + compactNumber(shown.volume)}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle options={["line", "candles"] as Mode[]} value={mode} onChange={setMode} labels={{ line: "Line", candles: "Candles" }} label="Chart type" />
          <Toggle
            options={RANGES}
            value={range}
            onChange={(r) => {
              if (r === range) return;
              setLoading(true);
              setRange(r);
            }}
            label="Time range"
          />
        </div>
      </div>
      <div className={cn("relative mt-4 h-[360px] w-full transition-opacity duration-200", loading && data ? "opacity-50" : "opacity-100")}>
        <div ref={el} className="absolute inset-0" />
        {data && data.length === 0 && !loading ? (
          <p className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-3">No trading data for this range yet.</p>
        ) : null}
      </div>
      <p className="mt-2 text-right text-[11px] text-ink-4">
        Charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-3">
          TradingView
        </a>
      </p>
    </div>
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
  labels,
  label,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-md border border-edge p-0.5">
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "inline-flex h-7 items-center rounded-[5px] px-2.5 text-[12px] transition-colors",
            o === value ? "bg-overlay-2 text-ink" : "text-ink-3 hover:text-ink",
          )}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}
