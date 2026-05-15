import { useMemo, useState } from "react";
import { theme } from "antd";
import { useTranslation } from "react-i18next";
import type { TokenTimeseriesResponse, TokenTimeseriesSeries } from "../api/client";

// Number of models to plot individually before rolling everything else into
// a single "其他" series. Keeps the chart legible at 6 distinct colors.
const MAX_SERIES = 6;

// Padding inside the SVG viewBox. Left padding leaves room for y-axis labels;
// bottom for x-axis date labels.
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 32;
const CHART_W = 720;
const CHART_H = 240;

// Palette derived from antd tokens so the chart picks up the active theme.
// The trailing entry is reserved for the "其他" rollup series.
// antd 5 GlobalToken only exposes semantic colors (primary/success/...) — the
// extra hues are kept literal so the palette stays at 8 distinct lines.
function paletteFromToken(t: ReturnType<typeof theme.useToken>["token"]): string[] {
  return [
    t.colorPrimary,
    t.colorSuccess,
    t.colorWarning,
    t.colorError,
    "#a371f7",
    "#1f6feb",
    "#e3b341",
    t.colorTextSecondary,
  ];
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function shortBucket(label: string, bucket: "day" | "hour"): string {
  if (bucket === "hour") {
    const parts = label.split(" ");
    return parts.length === 2 ? `${parts[1]}:00` : label;
  }
  return label.length >= 10 ? label.slice(5) : label;
}

function bucketDate(label: string): string {
  return label.length >= 10 ? label.slice(0, 10) : label;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const frac = value / pow;
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

interface RolledUpSeries extends TokenTimeseriesSeries {
  label: string;
  color: string;
  isOther?: boolean;
}

function rollupSeries(
  series: TokenTimeseriesSeries[],
  bucketCount: number,
  colors: string[],
  otherLabel: (count: number) => string,
  otherShort: (count: number) => string
): RolledUpSeries[] {
  if (series.length === 0) return [];
  const top = series.slice(0, MAX_SERIES);
  const rest = series.slice(MAX_SERIES);
  const result: RolledUpSeries[] = top.map((s, i) => ({
    ...s,
    label: s.upstream_model,
    color: colors[i % (colors.length - 1)],
  }));
  if (rest.length > 0) {
    const tokens = new Array(bucketCount).fill(0);
    const prompt = new Array(bucketCount).fill(0);
    const completion = new Array(bucketCount).fill(0);
    let total = 0;
    for (const s of rest) {
      for (let i = 0; i < bucketCount; i++) {
        tokens[i] += s.tokens[i] ?? 0;
        prompt[i] += s.prompt_tokens[i] ?? 0;
        completion[i] += s.completion_tokens[i] ?? 0;
      }
      total += s.total;
    }
    result.push({
      provider_id: "*",
      upstream_model: otherShort(rest.length),
      tokens,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total,
      label: otherLabel(rest.length),
      color: colors[colors.length - 1],
      isOther: true,
    });
  }
  return result;
}

export function TokenChart({ data }: { data: TokenTimeseriesResponse }) {
  const { t } = useTranslation("dashboard");
  const { token } = theme.useToken();
  const colors = useMemo(() => paletteFromToken(token), [token]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ x: number; bucketIdx: number } | null>(null);

  const allSeries = useMemo(
    () =>
      rollupSeries(
        data.series,
        data.buckets.length,
        colors,
        (count) => t("chart.otherSeries", { count }),
        (count) => t("chart.otherShort", { count })
      ),
    [data.series, data.buckets.length, colors, t]
  );

  const visibleSeries = useMemo(
    () => allSeries.filter((s) => !hidden.has(s.upstream_model)),
    [allSeries, hidden]
  );

  const yMax = useMemo(() => {
    let peak = 0;
    for (const s of visibleSeries) {
      for (const v of s.tokens) {
        if (v > peak) peak = v;
      }
    }
    return niceCeil(peak);
  }, [visibleSeries]);

  const bucketCount = data.buckets.length;
  const plotW = CHART_W - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const stepX = bucketCount > 1 ? plotW / (bucketCount - 1) : 0;

  function xFor(i: number): number {
    if (bucketCount === 1) return PAD_LEFT + plotW / 2;
    return PAD_LEFT + i * stepX;
  }
  function yFor(value: number): number {
    if (yMax === 0) return PAD_TOP + plotH;
    return PAD_TOP + plotH - (value / yMax) * plotH;
  }

  function toggle(model: string) {
    const next = new Set(hidden);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    setHidden(next);
  }

  const targetLabels = data.bucket === "hour" ? 10 : 8;
  const xLabelStep = Math.max(1, Math.ceil(bucketCount / targetLabels));

  const dayBreaks: number[] = [];
  if (data.bucket === "hour") {
    let prev = "";
    for (let i = 0; i < data.buckets.length; i++) {
      const d = bucketDate(data.buckets[i]);
      if (d !== prev && i > 0) dayBreaks.push(i);
      prev = d;
    }
  }

  function xLabelFor(i: number): string {
    if (data.bucket === "hour") {
      const isStart = i === 0 || dayBreaks.includes(i);
      if (isStart) {
        const parts = data.buckets[i].split(" ");
        return parts.length === 2 ? `${parts[0].slice(5)} ${parts[1]}:00` : data.buckets[i];
      }
    }
    return shortBucket(data.buckets[i], data.bucket);
  }

  const yTicks = useMemo(() => {
    const steps = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= steps; i++) ticks.push((yMax * i) / steps);
    return ticks;
  }, [yMax]);

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (bucketCount === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    if (svgX < PAD_LEFT || svgX > CHART_W - PAD_RIGHT) {
      setHover(null);
      return;
    }
    const relative = svgX - PAD_LEFT;
    const idx =
      bucketCount === 1 ? 0 : Math.round((relative / plotW) * (bucketCount - 1));
    const clamped = Math.max(0, Math.min(bucketCount - 1, idx));
    setHover({ x: xFor(clamped), bucketIdx: clamped });
  }
  function onMouseLeave() {
    setHover(null);
  }

  const allEmpty = visibleSeries.every((s) => s.total === 0);

  const borderColor = token.colorBorderSecondary;
  const subtleColor = token.colorTextSecondary;
  const accentColor = token.colorPrimary;
  const fgColor = token.colorText;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        preserveAspectRatio="none"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {yTicks.map((tick, i) => {
          const y = yFor(tick);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                x2={CHART_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke={borderColor}
                strokeDasharray={i === 0 ? "0" : "2 4"}
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fill={subtleColor}
                fontSize="10"
              >
                {formatTokens(tick)}
              </text>
            </g>
          );
        })}

        {dayBreaks.map((i) => (
          <line
            key={`db-${i}`}
            x1={xFor(i)}
            x2={xFor(i)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            stroke={borderColor}
            strokeWidth="1"
            opacity="0.5"
          />
        ))}

        {data.buckets.map((day, i) => {
          if (i % xLabelStep !== 0 && i !== bucketCount - 1) return null;
          return (
            <text
              key={day + i}
              x={xFor(i)}
              y={CHART_H - 10}
              textAnchor="middle"
              fill={subtleColor}
              fontSize="10"
            >
              {xLabelFor(i)}
            </text>
          );
        })}

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            stroke={accentColor}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.6"
          />
        )}

        {visibleSeries.map((s) => {
          const pts = s.tokens.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
          return (
            <g key={s.upstream_model}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {bucketCount <= 14 &&
                s.tokens.map((v, i) => (
                  <circle
                    key={i}
                    cx={xFor(i)}
                    cy={yFor(v)}
                    r={hover?.bucketIdx === i ? 4 : 2.5}
                    fill={s.color}
                  >
                    <title>{`${data.buckets[i]} · ${s.label}: ${v.toLocaleString()} tokens`}</title>
                  </circle>
                ))}
            </g>
          );
        })}

        {allEmpty && (
          <text
            x={CHART_W / 2}
            y={CHART_H / 2}
            textAnchor="middle"
            fill={subtleColor}
            fontSize="13"
          >
            {t("chart.empty")}
          </text>
        )}
      </svg>

      {hover && !allEmpty && (
        <div
          style={{
            position: "absolute",
            top: 24,
            left: `${(hover.x / CHART_W) * 100}%`,
            transform: "translateX(-50%)",
            background: token.colorBgElevated,
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 11,
            pointerEvents: "none",
            zIndex: 2,
            boxShadow: token.boxShadow,
            minWidth: 160,
            color: fgColor,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {data.buckets[hover.bucketIdx]}
          </div>
          {visibleSeries.map((s) => {
            const v = s.tokens[hover.bucketIdx] ?? 0;
            if (v === 0) return null;
            return (
              <div
                key={s.upstream_model}
                style={{
                  display: "grid",
                  gridTemplateColumns: "10px 1fr auto",
                  gap: 6,
                  alignItems: "center",
                  margin: "2px 0",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.color,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.label}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {v.toLocaleString()}
                </span>
              </div>
            );
          })}
          {visibleSeries.every((s) => (s.tokens[hover.bucketIdx] ?? 0) === 0) && (
            <div style={{ color: subtleColor, fontStyle: "italic" }}>
              {t("chart.tooltipEmpty")}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${borderColor}`,
        }}
      >
        {allSeries.map((s) => {
          const isHidden = hidden.has(s.upstream_model);
          return (
            <button
              key={s.upstream_model}
              onClick={() => toggle(s.upstream_model)}
              title={t("chart.legendTitle", { label: s.label })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: token.colorFillTertiary,
                border: `1px solid ${borderColor}`,
                borderRadius: 100,
                padding: "4px 10px 4px 6px",
                fontSize: 11,
                color: fgColor,
                cursor: "pointer",
                opacity: isHidden ? 0.4 : 1,
                transition: "opacity 0.15s",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: s.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {s.isOther ? (
                  s.label
                ) : (
                  <>
                    <span style={{ color: subtleColor }}>{s.provider_id}/</span>
                    {s.upstream_model}
                  </>
                )}
              </span>
              <span
                style={{
                  color: subtleColor,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 10.5,
                  paddingLeft: 4,
                  borderLeft: `1px solid ${borderColor}`,
                  marginLeft: 4,
                }}
              >
                {formatTokens(s.total)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
