// ─── Practice Board — Diagram Studio (full-screen) ─────────────────────────
// A full-screen, move-first diagram studio for building drills. The coach
// places players, cones, goals, zones and arrows on a pitch whose dimensions
// are real yards, then the drill's setup fields are filled in from that.
// Works on desktop (mouse, wheel zoom, shortcuts) AND phone (tap-to-place,
// pinch zoom, big targets) with ONE interaction model — no modes.
//
// The best ideas from the research (work/diagram-research.md), meshed into
// one editor:
//   TacticalPad — drag from a palette, drag off the pitch to delete.
//   JLA — bend handle on an arrow's midpoint; drag it and the run curves.
//   SoccerBlade — click start → click end arrows, double-click to edit,
//     marquee + bulk edit.
//   Coach Tactic Board — a grid that appears while you drag to help align.
//   Figma — live smart guides: red lines when things line up, while dragging.
//
// Board state lives in ./boardData (v2, stored on the drill doc as
// `diagramData`). All positions are normalized 0..1 across the pitch area, so
// a board stays valid when the yard dimensions change. Arrows may carry an
// optional `bend` control point (curved arrow) and `color`; tokens may carry
// an optional `rot` (equipment rotation). Old diagrams without those fields
// load and render exactly as before.
//
// onSave(pngBlob, state) — pngBlob is a rasterized image saved as the drill
// diagram; state is the structured JSON above so the board is re-editable.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  VB_W, LEG_H, clamp, BOARD_PRESETS, TEAM_COLORS, ARROW_LEGEND,
  ARROW_COLORS, TOKEN_HALF, wavyPath, arrowGeom, pitchSnapLines,
  normalizeBoardState, boardDims,
} from "./boardData";
import {
  X, Trash2, RotateCcw, Undo2, Redo2, MousePointer2, Save,
  Copy, Magnet, Hand, SquareDashed, CircleDashed, ZoomIn, ZoomOut,
  Maximize, LayoutGrid, Move, RotateCw,
} from "lucide-react";

const M = 30;          // pitch inset margin
const R = 19;          // player token radius (board units)
const HIT_R = 34;      // invisible touch-hit radius around tokens
const rid = () => Math.random().toString(36).slice(2, 9);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ARROW_WHITE = "#FFFFFF"; // default arrow colour on the green pitch
const EQUIPMENT_KINDS = new Set(["goal", "mannequin", "pole", "ladder"]);
const colorKey = (c) => (c || ARROW_WHITE).replace("#", "");

// Number badge on an arrow: a dark disc with a white ring and a bold white
// number, centred on the arrow's midpoint (the curve midpoint when bent).
// Numbers run in draw order (1 = first line drawn), so the sequence of a
// drill reads off the board and renumbers itself when a line is deleted.
// The disc sits on top of the line so it reads on the green pitch and on
// the line itself, and it is part of the SVG so it exports with the PNG.
const ARROW_NUM_R = 14;
function ArrowNumber({ x, y, n, dataAid, onPointerDown }) {
  return (
    <g>
      <circle cx={x} cy={y} r={ARROW_NUM_R} fill="#0F172A" stroke="#FFFFFF" strokeWidth={2}
        data-aid={dataAid} onPointerDown={onPointerDown}
        style={onPointerDown || dataAid ? { cursor: "pointer" } : undefined} />
      <text x={x} y={y + 5.5} textAnchor="middle" fontSize={16} fontWeight="800" fill="#FFFFFF" style={{ pointerEvents: "none" }}>{n}</text>
    </g>
  );
}

// White line style shared by all field markings.
const L = { fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 3 };

// To-scale pitch markings. (wYd = yards across, dYd = yards deep, goal at the
// top for portrait presets, goals at both ends for the full pitch.)
function PitchMarks({ preset, wYd, dYd, pitchH }) {
  const X = (xYd) => M + (xYd / wYd) * (VB_W - 2 * M);
  const Y = (yYd) => M + (yYd / dYd) * (pitchH - 2 * M);
  const cx = VB_W / 2;
  const bg = <rect x={0} y={0} width={VB_W} height={pitchH} fill="#2E7D46" />;
  const stripes = Array.from({ length: 8 }).map((_, i) => (
    <rect key={i} x={0} y={(pitchH / 8) * i} width={VB_W} height={pitchH / 8} fill={i % 2 ? "#2A7341" : "#2E7D46"} />
  ));
  const boundary = <rect x={M} y={M} width={VB_W - 2 * M} height={pitchH - 2 * M} {...L} />;
  const goalBar = (gx, gy, horizontal) => (
    horizontal
      ? <rect x={gx - (3.66 / wYd) * (VB_W - 2 * M)} y={gy - 5} width={(7.32 / wYd) * (VB_W - 2 * M)} height={10} fill="rgba(255,255,255,0.95)" />
      : <rect x={gx - 5} y={gy - (3.66 / dYd) * (pitchH - 2 * M)} width={10} height={(7.32 / dYd) * (pitchH - 2 * M)} fill="rgba(255,255,255,0.95)" />
  );
  // Penalty arc: circle r=9.15yd around the spot, drawn only outside the box.
  const arc = (spotX, spotY, boxEdge, horizontal, sweep = 1) => {
    const r = 9.15;
    const off = Math.sqrt(Math.max(0, r * r - 36)); // 6yd from spot to box line
    if (horizontal) {
      const x1 = X(boxEdge), y1 = Y(spotY - off), x2 = X(boxEdge), y2 = Y(spotY + off);
      return <path d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${(r / wYd) * (VB_W - 2 * M)} ${(r / dYd) * (pitchH - 2 * M)} 0 0 ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`} {...L} />;
    }
    const x1 = X(spotX - off), y1 = Y(boxEdge), x2 = X(spotX + off), y2 = Y(boxEdge);
    return <path d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${(r / wYd) * (VB_W - 2 * M)} ${(r / dYd) * (pitchH - 2 * M)} 0 0 ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`} {...L} />;
  };

  if (preset.id === "grid") {
    return (
      <g>
        {bg}{stripes}{boundary}
        <line x1={cx} y1={M} x2={cx} y2={pitchH - M} {...L} strokeDasharray="8 6" strokeWidth={2} />
      </g>
    );
  }

  if (preset.orient === "portrait") {
    // Goal at the top; penalty box measured down from the top line.
    // The penalty box is ALWAYS its true 44 yd wide — never stretched to
    // fill the preset — so it stays in proportion to the field (15.5 yd
    // of field on each side on the half pitch and the final third).
    const boxW = 44, boxD = 18, sixW = 20, sixD = 6;
    const midYd = wYd / 2;
    // Centre-circle arc on the halfway line (half pitch only): the circle
    // is centred on the bottom edge, so only its top half shows — the
    // visual cue that this is a true half of the field.
    const centreArc = preset.id === "half" ? (
      <path
        d={`M ${X(midYd - 10).toFixed(1)} ${Y(dYd).toFixed(1)} A ${((10 / wYd) * (VB_W - 2 * M)).toFixed(1)} ${((10 / dYd) * (pitchH - 2 * M)).toFixed(1)} 0 0 1 ${X(midYd + 10).toFixed(1)} ${Y(dYd).toFixed(1)}`}
        {...L}
      />
    ) : null;
    return (
      <g>
        {bg}{stripes}{boundary}
        {goalBar(cx, M, true)}
        <rect x={X(midYd - boxW / 2)} y={M} width={X(midYd + boxW / 2) - X(midYd - boxW / 2)} height={Y(boxD) - M} {...L} />
        <rect x={X(midYd - sixW / 2)} y={M} width={X(midYd + sixW / 2) - X(midYd - sixW / 2)} height={Y(sixD) - M} {...L} />
        <circle cx={cx} cy={Y(12)} r={4} fill="rgba(255,255,255,0.85)" />
        {arc(midYd, 12, boxD, false)}
        <line x1={M} y1={pitchH - M} x2={VB_W - M} y2={pitchH - M} {...L} strokeWidth={4} />
        {centreArc}
      </g>
    );
  }

  // Full pitch, landscape — goals at both ends.
  const boxW = 44, boxD = 18, sixW = 20, sixD = 6;
  const box = (left) => {
    const x0 = left ? M : VB_W - M - (X(boxD) - M);
    return (
      <g key={left ? "l" : "r"}>
        <rect x={x0} y={Y((dYd - boxW) / 2)} width={X(boxD) - M} height={Y((dYd + boxW) / 2) - Y((dYd - boxW) / 2)} {...L} />
        <rect x={left ? M : VB_W - M - (X(sixD) - M)} y={Y((dYd - sixW) / 2)} width={X(sixD) - M} height={Y((dYd + sixW) / 2) - Y((dYd - sixW) / 2)} {...L} />
        <circle cx={left ? X(12) : X(wYd - 12)} cy={pitchH / 2} r={4} fill="rgba(255,255,255,0.85)" />
        {arc(left ? 12 : wYd - 12, dYd / 2, left ? boxD : wYd - boxD, true, left ? 1 : 0)}
        {goalBar(left ? M : VB_W - M, pitchH / 2, false)}
      </g>
    );
  };
  return (
    <g>
      {bg}{stripes}{boundary}
      <line x1={cx} y1={M} x2={cx} y2={pitchH - M} {...L} />
      <circle cx={cx} cy={pitchH / 2} r={(10 / wYd) * (VB_W - 2 * M)} {...L} />
      <circle cx={cx} cy={pitchH / 2} r={5} fill="rgba(255,255,255,0.85)" />
      {box(true)}{box(false)}
    </g>
  );
}

// A goal marker, drawn as a white frame with a light net.
function GoalMark({ x, y }) {
  const w = 84, h = 34;
  const left = x - w / 2, top = y - h / 2;
  const nets = [];
  for (let i = 1; i < 6; i++) nets.push(<line key={"v" + i} x1={left + (w / 6) * i} y1={top} x2={left + (w / 6) * i} y2={top + h} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />);
  nets.push(<line key="h" x1={left} y1={y} x2={left + w} y2={y} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />);
  return (
    <g>
      <rect x={left} y={top} width={w} height={h} rx={3} fill="rgba(255,255,255,0.14)" stroke="#fff" strokeWidth={3} />
      {nets}
    </g>
  );
}

// One token's glyph, drawn at pixel (x, y). Pure — no handlers, no hit
// area — so BoardSvg and the editor render the exact same picture.
function TokenGlyph({ t, x, y }) {
  const rot = t.rot ? `rotate(${t.rot} ${x} ${y})` : undefined;
  if (t.kind === "ball") return (
    <g transform={rot}>
      <circle cx={x} cy={y} r={12} fill="#fff" stroke="#111" strokeWidth={2} />
      <circle cx={x} cy={y} r={4.5} fill="#111" />
    </g>
  );
  if (t.kind === "cone") return (
    <polygon transform={rot} points={`${x},${y - 16} ${x - 13},${y + 12} ${x + 13},${y + 12}`} fill="#F97316" stroke="#7C2D12" strokeWidth={2} />
  );
  if (t.kind === "goal") return <g transform={rot}><GoalMark x={x} y={y} /></g>;
  if (t.kind === "mannequin") return (
    <g transform={rot}>
      <rect x={x - 9} y={y - 18} width={18} height={36} rx={8} fill="#94A3B8" stroke="#475569" strokeWidth={2} />
      <rect x={x - 13} y={y + 16} width={26} height={5} rx={2.5} fill="#64748B" />
    </g>
  );
  if (t.kind === "pole") return (
    <g transform={rot}>
      <rect x={x - 3} y={y - 20} width={6} height={40} rx={3} fill="#FBBF24" stroke="#92400E" strokeWidth={1.5} />
      <ellipse cx={x} cy={y + 20} rx={8} ry={3} fill="#78350F" />
    </g>
  );
  if (t.kind === "ladder") return (
    <g transform={rot}>
      <rect x={x - 20} y={y - 7} width={40} height={14} rx={3} fill="#94A3B8" stroke="#475569" strokeWidth={2} />
      <line x1={x - 12} y1={y - 7} x2={x - 12} y2={y + 7} stroke="#475569" strokeWidth={2} />
      <line x1={x - 4} y1={y - 7} x2={x - 4} y2={y + 7} stroke="#475569" strokeWidth={2} />
      <line x1={x + 4} y1={y - 7} x2={x + 4} y2={y + 7} stroke="#475569" strokeWidth={2} />
      <line x1={x + 12} y1={y - 7} x2={x + 12} y2={y + 7} stroke="#475569" strokeWidth={2} />
    </g>
  );
  return (
    <g transform={rot}>
      <circle cx={x} cy={y} r={R} fill={TEAM_COLORS[t.kind] || "#64748B"} stroke="rgba(0,0,0,0.4)" strokeWidth={2} />
      {t.label ? <text x={x} y={y + R * 0.34} textAnchor="middle" fontSize={R * 0.85} fontWeight="700" fill="#fff" style={{ pointerEvents: "none" }}>{t.label}</text> : null}
    </g>
  );
}

// Arrowhead markers, one pair per arrow colour. (IDs are duplicated across
// BoardSvg instances on a page, like the old board — every copy defines the
// same shapes, so the first match always renders identically.)
function ArrowMarkers() {
  return (
    <>
      {ARROW_COLORS.map((c) => (
        <g key={c}>
          <marker id={`bs-head-${colorKey(c)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
          </marker>
          <marker id={`bs-open-${colorKey(c)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0.5 0.5 L 9 5 L 0.5 9.5" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
          </marker>
        </g>
      ))}
    </>
  );
}

// One arrow: visible line(s) + number badge. `interactive` adds the fat
// invisible hit path and the bend handle (editor only).
function ArrowShape({ a, index, px, py, interactive, selected, onDown }) {
  const geom = arrowGeom(a, px, py);
  const color = a.color || ARROW_WHITE;
  const key = colorKey(color);
  const head = a.kind === "pass" ? `url(#bs-open-${key})` : `url(#bs-head-${key})`;
  const width = a.kind === "pass" ? 3.5 : a.kind === "shot" ? 2.5 : 4;
  const dash = a.kind === "run" ? "10 7" : undefined;
  const bendPos = a.bend ? { x: px(a.bend.x), y: py(a.bend.y) } : geom.mid;
  return (
    <g>
      {interactive && (
        <path d={geom.d} fill="none" stroke="transparent" strokeWidth={20} data-aid={a.id}
          onPointerDown={onDown} style={{ cursor: "pointer" }} />
      )}
      {selected && (
        <path d={geom.d} fill="none" stroke="#38BDF8" strokeWidth={9} opacity={0.35} strokeLinecap="round" style={{ pointerEvents: "none" }} />
      )}
      {geom.d2
        ? <g style={{ pointerEvents: "none" }}>
          <path d={geom.d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
          <path d={geom.d2} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" markerEnd={head} />
        </g>
        : <path d={geom.d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
          strokeDasharray={dash} markerEnd={head} style={{ pointerEvents: interactive ? "none" : undefined }} />}
      <ArrowNumber x={geom.mid.x} y={geom.mid.y} n={index + 1} dataAid={interactive ? a.id : undefined} onPointerDown={interactive ? onDown : undefined} />
      {interactive && selected && (
        <g>
          {a.bend && <line x1={geom.mid.x} y1={geom.mid.y} x2={bendPos.x} y2={bendPos.y} stroke="#38BDF8" strokeWidth={2} strokeDasharray="4 3" style={{ pointerEvents: "none" }} />}
          <circle cx={bendPos.x} cy={bendPos.y} r={11} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={2.5}
            data-bend={a.id} onPointerDown={onDown} style={{ cursor: "grab" }} />
          <circle cx={bendPos.x} cy={bendPos.y} r={3.5} fill="#FFFFFF" style={{ pointerEvents: "none" }} />
        </g>
      )}
    </g>
  );
}

// Read-only render of a board state (thumbnails, session rows, PDFs). No
// editing chrome — just the pitch, zones, arrows and markers.
export function BoardSvg({ state, className = "", showLegend = false }) {
  const s = normalizeBoardState(state);
  const { preset, wYd, dYd, pitchH, vbH } = boardDims(s);
  const px = (x) => M + x * (VB_W - 2 * M);
  const py = (y) => M + y * (pitchH - 2 * M);
  return (
    <svg viewBox={`0 0 ${VB_W} ${showLegend ? vbH : pitchH}`} className={className} role="img" aria-label="Drill diagram">
      <defs><ArrowMarkers /></defs>
      <PitchMarks preset={preset} wYd={wYd} dYd={dYd} pitchH={pitchH} />
      {s.zones.map((z) => (
        z.shape === "circle"
          ? <circle key={z.id} cx={px(z.x)} cy={py(z.y)} r={z.r * (VB_W - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeDasharray="8 6" />
          : <rect key={z.id} x={px(z.x)} y={py(z.y)} width={z.w * (VB_W - 2 * M)} height={z.h * (pitchH - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeDasharray="8 6" rx={6} />
      ))}
      {s.arrows.map((a, i) => <ArrowShape key={a.id} a={a} index={i} px={px} py={py} />)}
      {s.tokens.map((t) => <TokenGlyph key={t.id} t={t} x={px(t.x)} y={py(t.y)} />)}
      {showLegend && <LegendStrip y={pitchH} />}
    </svg>
  );
}

// The fixed 5-arrow legend, drawn as an SVG strip so it exports with the PNG.
function LegendStrip({ y }) {
  const items = [
    { kind: "pass", label: "Pass" },
    { kind: "run", label: "Run" },
    { kind: "dribble", label: "Dribble" },
    { kind: "shot", label: "Shot" },
    { kind: "direction", label: "Direction" },
  ];
  const colW = VB_W / 5;
  return (
    <g>
      <rect x={0} y={y} width={VB_W} height={LEG_H} fill="#0F172A" />
      {items.map((it, i) => {
        const cx = colW * i + colW / 2;
        const x1 = cx - 42, x2 = cx + 42, cy = y + 30;
        const sample = it.kind === "dribble"
          ? <path d={wavyPath(x1, cy, x2, cy, 5, 14)} fill="none" stroke={ARROW_WHITE} strokeWidth={3} strokeLinecap="round" markerEnd="url(#bs-head-FFFFFF)" />
          : it.kind === "shot"
            ? <g><line x1={x1} y1={cy - 4} x2={x2} y2={cy - 4} stroke={ARROW_WHITE} strokeWidth={2} /><line x1={x1} y1={cy + 4} x2={x2} y2={cy + 4} stroke={ARROW_WHITE} strokeWidth={2} markerEnd="url(#bs-head-FFFFFF)" /></g>
            : <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={ARROW_WHITE} strokeWidth={3.5} strokeLinecap="round" strokeDasharray={it.kind === "run" ? "9 6" : undefined} markerEnd={it.kind === "pass" ? "url(#bs-open-FFFFFF)" : "url(#bs-head-FFFFFF)"} />;
        return (
          <g key={it.kind}>
            {sample}
            <text x={cx} y={y + 58} textAnchor="middle" fontSize={13} fontWeight="600" fill="#fff">{it.label}</text>
          </g>
        );
      })}
    </g>
  );
}

// ─── Diagram Studio (full-screen editor) ───────────────────────────────────

const PALETTE = [
  { kind: "focus", label: "Focus" },
  { kind: "opp", label: "Opp" },
  { kind: "gk", label: "GK" },
  { kind: "ball", label: "Ball" },
  { kind: "cone", label: "Cone" },
  { kind: "goal", label: "Goal" },
  { kind: "mannequin", label: "Mannequin" },
  { kind: "pole", label: "Pole" },
  { kind: "ladder", label: "Ladder" },
];
const ARROW_TOOLS = [
  { kind: "pass", label: "Pass" },
  { kind: "run", label: "Run" },
  { kind: "dribble", label: "Dribble" },
  { kind: "shot", label: "Shot" },
  { kind: "direction", label: "Direction" },
  { kind: "curve", label: "Curve" },
  { kind: "freehand", label: "Freehand" },
];

function PaletteGlyph({ kind }) {
  const c = TEAM_COLORS[kind];
  if (c) return <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black text-white" style={{ background: c }}>{kind === "gk" ? "GK" : ""}</span>;
  if (kind === "ball") return <span className="w-5 h-5 rounded-full bg-white border-2 border-slate-900" />;
  if (kind === "cone") return <span className="w-0 h-0" style={{ borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderBottom: "16px solid #F97316" }} />;
  if (kind === "goal") return <span className="w-7 h-4 border-[3px] border-white rounded-sm bg-white/15" />;
  if (kind === "mannequin") return <span className="w-3.5 h-6 rounded-full bg-slate-400" />;
  if (kind === "pole") return <span className="w-1.5 h-6 rounded bg-amber-400" />;
  if (kind === "ladder") return <span className="w-7 h-3.5 rounded-sm bg-slate-400 border-y-2 border-slate-600" />;
  return null;
}

function ArrowPreview({ kind }) {
  if (kind === "freehand") return (
    <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
      <path d="M 1 8 Q 6 2 11 7 T 21 6 T 29 4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
  if (kind === "curve") return (
    <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
      <path d="M 1 10 Q 15 -4 29 6" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="4 2.5" markerEnd="url(#pv-head)" />
      <defs><marker id="pv-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" /></marker></defs>
    </svg>
  );
  return (
    <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
      {kind === "dribble"
        ? <path d={wavyPath(1, 6, 29, 6, 2.5, 8)} fill="none" stroke="#fff" strokeWidth="1.8" />
        : kind === "shot"
          ? <g><line x1="1" y1="4" x2="29" y2="4" stroke="#fff" strokeWidth="1.4" /><line x1="1" y1="8" x2="29" y2="8" stroke="#fff" strokeWidth="1.4" /></g>
          : <line x1="1" y1="6" x2="29" y2="6" stroke="#fff" strokeWidth="2" strokeDasharray={kind === "run" ? "4 3" : undefined} markerEnd={kind === "pass" ? "url(#pv-open)" : "url(#pv-head)"} />}
      <defs>
        <marker id="pv-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" /></marker>
        <marker id="pv-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M 0.5 0.5 L 9 5 L 0.5 9.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></marker>
      </defs>
    </svg>
  );
}

export default function TacticsBoard({ initial, onSave, onClose, title = "Diagram", onStateChange }) {
  const init = normalizeBoardState(initial);
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const exportRef = useRef(null);
  const labelInputRef = useRef(null);
  const [field, setField] = useState(init.field);
  const [lengthYd, setLengthYd] = useState(init.lengthYd);
  const [widthYd, setWidthYd] = useState(init.widthYd);
  const [tokens, setTokens] = useState(init.tokens);
  const [arrows, setArrows] = useState(init.arrows);
  const [zones, setZones] = useState(init.zones);
  const [sel, setSel] = useState([]); // ids across tokens/arrows/zones
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [base, setBase] = useState({ w: 680, h: 400, cw: 800, ch: 600 });
  const [showGrid, setShowGrid] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [armed, setArmed] = useState(null); // {tool:'place',kind} | {tool:'arrow',kind} | {tool:'zone',shape}
  const [arrowColor, setArrowColor] = useState(ARROW_COLORS[0]);
  const [aim, setAim] = useState(null); // {from, to, kind, lockId}
  const [guides, setGuides] = useState([]); // {axis:'x'|'y', at} normalized
  const [draftZone, setDraftZone] = useState(null);
  const [draftFree, setDraftFree] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [ghost, setGhost] = useState(null); // palette drag ghost {kind, cx, cy}
  const [busy, setBusy] = useState(false);
  const [focusInspector, setFocusInspector] = useState(false);

  const gesture = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const spaceDown = useRef(false);
  const altDown = useRef(false);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const longPress = useRef(null);
  const lastArrowKind = useRef("run");

  const dims = boardDims({ field, lengthYd, widthYd });
  const { preset, wYd, dYd, pitchH, vbH } = dims;
  const { zoom, pan } = view;
  const state = () => ({ field, lengthYd, widthYd, tokens, arrows, zones });
  const snapLines = useMemo(() => pitchSnapLines({ field, lengthYd, widthYd }), [field, lengthYd, widthYd]);

  // Live state for the test harness / parent (read-only notification, not
  // a state sync — the parent stores it in a ref, it never re-renders us).
  useEffect(() => { onStateChange?.(state()); });
  useEffect(() => {
    // One-shot flag: focus the inspector's label field, then clear the flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focusInspector) { labelInputRef.current?.focus(); setFocusInspector(false); }
  }, [focusInspector, sel]);

  const origin = (v) => ({
    x: (base.cw - base.w * v.zoom) / 2 + v.pan.x,
    y: (base.ch - base.h * v.zoom) / 2 + v.pan.y,
  });
  const zoomAround = (cx, cy, factor) => {
    setView((v) => {
      const newZoom = clamp(v.zoom * factor, 0.3, 3);
      const o = origin(v);
      const bx = (cx - o.x) / v.zoom, by = (cy - o.y) / v.zoom;
      const nOx = cx - bx * newZoom, nOy = cy - by * newZoom;
      return {
        zoom: newZoom,
        pan: { x: nOx - (base.cw - base.w * newZoom) / 2, y: nOy - (base.ch - base.h * newZoom) / 2 },
      };
    });
  };
  const fitView = () => setView({ zoom: 1, pan: { x: 0, y: 0 } });

  // Fit the pitch to the canvas whenever the container or preset changes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      const scale = Math.min(cw / VB_W, ch / pitchH) || 1;
      setBase({ w: VB_W * scale, h: pitchH * scale, cw, ch });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pitchH]);

  // Wheel zoom (native listener — React's wheel is passive, so preventDefault
  // would warn). Zoom keeps the point under the cursor fixed.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onW = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onW, { passive: false });
    return () => el.removeEventListener("wheel", onW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const px = (x) => M + x * (VB_W - 2 * M);
  const py = (y) => M + y * (pitchH - 2 * M);
  const normFromPx = (pxv, pyv) => ({ x: clamp01((pxv - M) / (VB_W - 2 * M)), y: clamp01((pyv - M) / (pitchH - 2 * M)) });
  const toBoard = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };
  const rectOfSvg = () => svgRef.current?.getBoundingClientRect();

  // ── undo / redo ──────────────────────────────────────────────────────────
  const snapshot = () => {
    undoStack.current.push({ field, lengthYd, widthYd, tokens: [...tokens], arrows: [...arrows], zones: [...zones] });
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
  };
  const applySnap = (s) => {
    setField(s.field); setLengthYd(s.lengthYd); setWidthYd(s.widthYd);
    setTokens(s.tokens); setArrows(s.arrows); setZones(s.zones || []); setSel([]);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ field, lengthYd, widthYd, tokens, arrows, zones });
    applySnap(prev);
  };
  const redo = () => {
    const nxt = redoStack.current.pop();
    if (!nxt) return;
    undoStack.current.push({ field, lengthYd, widthYd, tokens, arrows, zones });
    applySnap(nxt);
  };

  // ── snapping ─────────────────────────────────────────────────────────────
  // Live smart guides: while dragging, snap the token's centre/edges to
  // other tokens' centres/edges and to pitch lines, and show a red guide
  // line where things line up. ~8 screen px threshold, Alt disables.
  const snapTokenPoint = (p, movingId) => {
    if (!snapOn || altDown.current) return { ...p, guides: [] };
    const r = rectOfSvg();
    if (!r) return { ...p, guides: [] };
    const thrX = 8 / r.width, thrY = 8 / r.height;
    const moving = tokens.find((t) => t.id === movingId);
    const halfX = moving ? (TOKEN_HALF[moving.kind] || 19) / VB_W : 0;
    const halfY = moving ? (TOKEN_HALF[moving.kind] || 19) / pitchH : 0;
    const candX = [], candY = [];
    tokens.forEach((t) => {
      if (t.id === movingId) return;
      const hx = (TOKEN_HALF[t.kind] || 19) / VB_W, hy = (TOKEN_HALF[t.kind] || 19) / pitchH;
      candX.push(t.x, t.x - hx, t.x + hx);
      candY.push(t.y, t.y - hy, t.y + hy);
    });
    snapLines.xs.forEach((v) => candX.push(v));
    snapLines.ys.forEach((v) => candY.push(v));
    const anchorsX = [p.x, p.x - halfX, p.x + halfX];
    const anchorsY = [p.y, p.y - halfY, p.y + halfY];
    let bestX = null, bestY = null;
    candX.forEach((c) => anchorsX.forEach((a, i) => {
      const d = Math.abs(a - c);
      if (d < thrX && (!bestX || d < bestX.d)) bestX = { d, c, i };
    }));
    candY.forEach((c) => anchorsY.forEach((a, i) => {
      const d = Math.abs(a - c);
      if (d < thrY && (!bestY || d < bestY.d)) bestY = { d, c, i };
    }));
    const out = { ...p, guides: [] };
    if (bestX) {
      out.x = bestX.c - (anchorsX[bestX.i] - p.x);
      out.guides.push({ axis: "x", at: bestX.c });
    }
    if (bestY) {
      out.y = bestY.c - (anchorsY[bestY.i] - p.y);
      out.guides.push({ axis: "y", at: bestY.c });
    }
    return out;
  };
  // Arrow endpoints snap to token centres within ~24 screen px.
  const snapEndpoint = (p) => {
    const r = rectOfSvg();
    if (!r) return { p, lockId: null };
    let best = null, bestD = 24;
    tokens.forEach((t) => {
      const d = Math.hypot((t.x - p.x) * r.width, (t.y - p.y) * r.height);
      if (d < bestD) { bestD = d; best = t; }
    });
    return best ? { p: { x: best.x, y: best.y }, lockId: best.id } : { p, lockId: null };
  };

  // ── selection & edits ────────────────────────────────────────────────────
  const selectId = (id, additive) => setSel((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  const findSel = (id) => {
    const t = tokens.find((x) => x.id === id);
    if (t) return { type: "token", item: t };
    const a = arrows.find((x) => x.id === id);
    if (a) return { type: "arrow", item: a };
    const z = zones.find((x) => x.id === id);
    if (z) return { type: "zone", item: z };
    return null;
  };
  const removeIds = (ids) => {
    setTokens((ts) => ts.filter((t) => !ids.includes(t.id)));
    setArrows((as) => as.filter((a) => !ids.includes(a.id)));
    setZones((zs) => zs.filter((z) => !ids.includes(z.id)));
  };
  const nextLabel = (kind, ts) => {
    if (kind === "focus" || kind === "opp") return String(ts.filter((t) => t.kind === kind).length + 1);
    if (kind === "gk") return "GK";
    return "";
  };
  const placeTokenAt = (kind, p) => {
    const pt = snapTokenPoint(p, null);
    setTokens((ts) => [...ts, { id: rid(), kind, x: pt.x, y: pt.y, label: nextLabel(kind, ts) }]);
  };
  const duplicateSelection = () => {
    if (!sel.length) return;
    snapshot();
    const newIds = [];
    setTokens((ts) => {
      const copies = [];
      ts.forEach((t) => {
        if (sel.includes(t.id)) {
          const c = { ...t, id: rid(), x: clamp01(t.x + 0.05), y: clamp01(t.y + 0.05), label: nextLabel(t.kind, ts) };
          copies.push(c); newIds.push(c.id);
        }
      });
      return [...ts, ...copies];
    });
    setArrows((as) => {
      const copies = [];
      as.forEach((a) => {
        if (sel.includes(a.id)) {
          const c = {
            ...a, id: rid(),
            from: { x: clamp01(a.from.x + 0.04), y: clamp01(a.from.y + 0.04) },
            to: { x: clamp01(a.to.x + 0.04), y: clamp01(a.to.y + 0.04) },
            bend: a.bend ? { x: clamp01(a.bend.x + 0.04), y: clamp01(a.bend.y + 0.04) } : undefined,
          };
          copies.push(c); newIds.push(c.id);
        }
      });
      return [...as, ...copies];
    });
    setZones((zs) => {
      const copies = [];
      zs.forEach((z) => {
        if (sel.includes(z.id)) {
          const c = { ...z, id: rid(), x: clamp01(z.x + 0.04), y: clamp01(z.y + 0.04) };
          copies.push(c); newIds.push(c.id);
        }
      });
      return [...zs, ...copies];
    });
    setSel(newIds);
  };
  const removeSelected = () => {
    if (!sel.length) return;
    snapshot();
    removeIds(sel);
    setSel([]);
  };
  const setLabel = (id, label) => setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, label: label.slice(0, 3) } : t)));
  const clearBoard = () => { snapshot(); setTokens([]); setArrows([]); setZones([]); setSel([]); };
  const changeField = (f) => {
    const preset = BOARD_PRESETS.find((p) => p.id === f);
    if (!preset) return;
    snapshot();
    setField(f);
    setLengthYd(preset.lengthYd);
    setWidthYd(preset.widthYd);
    fitView();
  };
  const changeDims = (len, wid) => {
    setLengthYd(clamp(Number(len) || 10, 5, 130));
    setWidthYd(clamp(Number(wid) || 10, 5, 130));
  };

  // Align / distribute for multi-selections (tokens + zones, by centre).
  const alignSel = (mode) => {
    const items = [];
    tokens.forEach((t) => {
      if (!sel.includes(t.id)) return;
      const h = TOKEN_HALF[t.kind] || 19;
      items.push({ type: "token", id: t.id, cx: t.x, cy: t.y, hw: h / VB_W, hh: h / pitchH });
    });
    zones.forEach((z) => {
      if (!sel.includes(z.id)) return;
      if (z.shape === "circle") items.push({ type: "zone", id: z.id, cx: z.x, cy: z.y, hw: z.r || 0.05, hh: (z.r || 0.05) * VB_W / pitchH });
      else items.push({ type: "zone", id: z.id, cx: z.x + z.w / 2, cy: z.y + z.h / 2, hw: z.w / 2, hh: z.h / 2 });
    });
    if (items.length < 2) return;
    snapshot();
    const apply = (fn) => {
      items.forEach((it) => {
        const { cx, cy } = fn(it);
        if (it.type === "token") setTokens((ts) => ts.map((t) => (t.id === it.id ? { ...t, x: cx, y: cy } : t)));
        else setZones((zs) => zs.map((z) => {
          if (z.id !== it.id) return z;
          return z.shape === "circle" ? { ...z, x: cx, y: cy } : { ...z, x: cx - z.w / 2, y: cy - z.h / 2 };
        }));
      });
    };
    if (mode === "left") { const v = Math.min(...items.map((i) => i.cx - i.hw)); apply((it) => ({ cx: v + it.hw, cy: it.cy })); }
    else if (mode === "center") { const v = items.reduce((s, i) => s + i.cx, 0) / items.length; apply((it) => ({ cx: v, cy: it.cy })); }
    else if (mode === "right") { const v = Math.max(...items.map((i) => i.cx + i.hw)); apply((it) => ({ cx: v - it.hw, cy: it.cy })); }
    else if (mode === "top") { const v = Math.min(...items.map((i) => i.cy - i.hh)); apply((it) => ({ cx: it.cx, cy: v + it.hh })); }
    else if (mode === "middle") { const v = items.reduce((s, i) => s + i.cy, 0) / items.length; apply((it) => ({ cx: it.cx, cy: v })); }
    else if (mode === "bottom") { const v = Math.max(...items.map((i) => i.cy + i.hh)); apply((it) => ({ cx: it.cx, cy: v - it.hh })); }
    else if (mode === "dist-h" || mode === "dist-v") {
      const key = mode === "dist-h" ? "cx" : "cy";
      const sorted = [...items].sort((a, b) => a[key] - b[key]);
      const first = sorted[0][key], last = sorted[sorted.length - 1][key];
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((it, i) => {
        const v = first + step * i;
        if (it.type === "token") setTokens((ts) => ts.map((t) => (t.id === it.id ? { ...t, [key]: v } : t)));
        else setZones((zs) => zs.map((z) => {
          if (z.id !== it.id) return z;
          if (z.shape === "circle") return { ...z, [key]: v };
          return key === "cx" ? { ...z, x: v - z.w / 2 } : { ...z, y: v - z.h / 2 };
        }));
      });
    }
  };

  // ── arrows ───────────────────────────────────────────────────────────────
  const finishArrow = (to) => {
    const a = aim;
    if (!a) return;
    const dx = to.x - a.from.x, dy = to.y - a.from.y;
    if (Math.hypot(dx * VB_W, dy * pitchH) < 12) { setAim(null); return; } // too short — cancel
    snapshot();
    let bend = null;
    if (a.kind === "curve") {
      // Start curved: control point offset perpendicular to the chord.
      const dxPx = dx * VB_W, dyPx = dy * pitchH;
      const lenPx = Math.hypot(dxPx, dyPx) || 1;
      const midPx = { x: px((a.from.x + to.x) / 2), y: py((a.from.y + to.y) / 2) };
      const off = lenPx * 0.18;
      bend = normFromPx(midPx.x + (-dyPx / lenPx) * off, midPx.y + (dxPx / lenPx) * off);
    }
    setArrows((as) => [...as, {
      id: rid(), kind: a.kind === "curve" ? "run" : a.kind,
      from: a.from, to, bend, color: arrowColor,
    }]);
    setAim(null);
    setArmed(null);
  };

  // ── save / export ────────────────────────────────────────────────────────
  const exportPng = () => new Promise((resolve, reject) => {
    const node = exportRef.current?.querySelector("svg");
    if (!node) { reject(new Error("no export node")); return; }
    const clone = node.cloneNode(true);
    clone.setAttribute("width", VB_W);
    clone.setAttribute("height", vbH);
    const xml = new XMLSerializer().serializeToString(clone);
    const src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = VB_W * 2; canvas.height = vbH * 2;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = src;
  });
  const save = async () => {
    setBusy(true);
    setSel([]); setAim(null); setArmed(null);
    try {
      const blob = await exportPng();
      await onSave?.(blob, state());
    } catch {
      await onSave?.(null, state());
    } finally {
      setBusy(false);
    }
  };

  // ── palette: drag from the rail, or tap to arm placement ────────────────
  const onPaletteDown = (e, kind) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const drag = { kind, moved: false };
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) drag.moved = true;
      setGhost({ kind, cx: ev.clientX, cy: ev.clientY });
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      if (!drag.moved) {
        // Tap: arm placement (tap again to disarm).
        setArmed((a) => (a?.tool === "place" && a.kind === kind ? null : { tool: "place", kind }));
      } else {
        const r = svgRef.current?.getBoundingClientRect();
        if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          snapshot();
          placeTokenAt(kind, toBoard(ev.clientX, ev.clientY));
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── pinch ────────────────────────────────────────────────────────────────
  const startPinch = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - rect.left, y: (pts[0].y + pts[1].y) / 2 - rect.top };
    const o = origin(view);
    pinch.current = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      zoom: view.zoom, ox: o.x, oy: o.y, mx: mid.x, my: mid.y,
    };
    gesture.current = null;
  };
  const updatePinch = () => {
    const pts = [...pointers.current.values()];
    const s = pinch.current;
    if (pts.length < 2 || !s) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - rect.left, y: (pts[0].y + pts[1].y) / 2 - rect.top };
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const newZoom = clamp(s.zoom * (dist / s.dist), 0.3, 3);
    const bx = (s.mx - s.ox) / s.zoom, by = (s.my - s.oy) / s.zoom;
    const nOx = mid.x - bx * newZoom, nOy = mid.y - by * newZoom;
    setView({
      zoom: newZoom,
      pan: { x: nOx - (base.cw - base.w * newZoom) / 2, y: nOy - (base.ch - base.h * newZoom) / 2 },
    });
  };

  // ── long-press = double-click (touch) ────────────────────────────────────
  const clearLongPress = () => { if (longPress.current) { clearTimeout(longPress.current.timer); longPress.current = null; } };
  const startLongPress = (id) => {
    clearLongPress();
    longPress.current = {
      id,
      timer: setTimeout(() => { setFocusInspector(true); longPress.current = null; }, 550),
    };
  };

  // ── pointer engine ───────────────────────────────────────────────────────
  const onSvgPointerDown = (e) => {
    if (e.button === 2) return;
    try { svgRef.current.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { startPinch(); return; }
    if (e.button === 1 || spaceDown.current) {
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, pan: { ...pan } };
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    // Pointer down on the canvas background (outside the pitch) pans.
    if (!e.target.closest?.("svg")) {
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, pan: { ...pan }, moved: false };
      return;
    }
    // Armed tools win over hit-testing.
    if (armed?.tool === "place") { snapshot(); placeTokenAt(armed.kind, p); setArmed(null); return; }
    if (armed?.tool === "arrow") {
      if (armed.kind === "freehand") {
        gesture.current = { type: "freehand" };
        setDraftFree([p]);
        return;
      }
      const s = snapEndpoint(p);
      if (!aim) setAim({ from: s.p, to: s.p, kind: armed.kind, lockId: s.lockId });
      else finishArrow(s.p);
      return;
    }
    if (armed?.tool === "zone") {
      gesture.current = { type: "zone-draw" };
      setDraftZone({ from: p, to: p, shape: armed.shape });
      return;
    }
    // Move tool: most specific handle first.
    const bendEl = e.target.closest?.("[data-bend]");
    if (bendEl) { gesture.current = { type: "bend", id: bendEl.dataset.bend, moved: false }; return; }
    const rotEl = e.target.closest?.("[data-rotate]");
    if (rotEl) { gesture.current = { type: "rotate", id: rotEl.dataset.rotate, moved: false }; return; }
    const resEl = e.target.closest?.("[data-resize]");
    if (resEl) { const [id, corner] = resEl.dataset.resize.split(":"); gesture.current = { type: "resize", id, corner, moved: false }; return; }
    const tokEl = e.target.closest?.("[data-tid]");
    if (tokEl) {
      const id = tokEl.dataset.tid;
      selectId(id, e.shiftKey);
      gesture.current = { type: "drag-token", id, moved: false };
      startLongPress(id);
      return;
    }
    const arrEl = e.target.closest?.("[data-aid]");
    if (arrEl) {
      const id = arrEl.dataset.aid;
      selectId(id, e.shiftKey);
      startLongPress(id);
      return;
    }
    const zoneEl = e.target.closest?.("[data-zid]");
    if (zoneEl) {
      const id = zoneEl.dataset.zid;
      selectId(id, e.shiftKey);
      gesture.current = { type: "drag-zone", id, moved: false };
      return;
    }
    gesture.current = { type: "maybe-marquee", start: p, sx: e.clientX, sy: e.clientY };
  };

  const onSvgPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) { updatePinch(); return; }
    const g = gesture.current;
    const p = toBoard(e.clientX, e.clientY);
    if (!g) {
      // Aiming an arrow: the ghost follows the pointer.
      if (aim && armed?.tool === "arrow") {
        const s = snapEndpoint(p);
        setAim((a) => (a ? { ...a, to: s.p, lockId: s.lockId } : a));
      }
      return;
    }
    if (longPress.current && Math.hypot(e.clientX - (g.sx || e.clientX), e.clientY - (g.sy || e.clientY)) > 10) clearLongPress();
    switch (g.type) {
      case "pan": {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
        setView((v) => ({ ...v, pan: { x: g.pan.x + (e.clientX - g.sx), y: g.pan.y + (e.clientY - g.sy) } }));
        break;
      }
      case "drag-token": {
        clearLongPress();
        if (!g.moved) { g.moved = true; snapshot(); }
        const sn = snapTokenPoint(p, g.id);
        setGuides(sn.guides);
        setTokens((ts) => ts.map((t) => (t.id === g.id ? { ...t, x: sn.x, y: sn.y } : t)));
        break;
      }
      case "drag-zone": {
        if (!g.moved) { g.moved = true; snapshot(); }
        setZones((zs) => zs.map((z) => {
          if (z.id !== g.id) return z;
          if (z.shape === "circle") return { ...z, x: clamp01(p.x), y: clamp01(p.y) };
          return { ...z, x: clamp01(p.x - z.w / 2), y: clamp01(p.y - z.h / 2) };
        }));
        break;
      }
      case "bend": {
        if (!g.moved) { g.moved = true; snapshot(); }
        setArrows((as) => as.map((a) => (a.id === g.id ? { ...a, bend: p } : a)));
        break;
      }
      case "rotate": {
        if (!g.moved) { g.moved = true; snapshot(); }
        const t = tokens.find((x) => x.id === g.id);
        if (!t) break;
        const cx = px(t.x), cy = py(t.y);
        const r = rectOfSvg();
        const sx = ((e.clientX - r.left) / r.width) * VB_W, sy = ((e.clientY - r.top) / r.height) * pitchH;
        let deg = Math.atan2(sy - cy, sx - cx) * 180 / Math.PI + 90;
        if (!altDown.current) deg = Math.round(deg / 45) * 45;
        deg = ((deg % 360) + 360) % 360;
        setTokens((ts) => ts.map((x) => (x.id === g.id ? { ...x, rot: deg } : x)));
        break;
      }
      case "resize": {
        if (!g.moved) { g.moved = true; snapshot(); }
        setZones((zs) => zs.map((z) => {
          if (z.id !== g.id) return z;
          if (z.shape === "circle") {
            const r = Math.max(0.02, Math.abs(p.x - z.x));
            return { ...z, r };
          }
          // The corner being dragged moves; the opposite corner stays put.
          const nx = g.corner.includes("w") ? Math.min(p.x, z.x + z.w - 0.02) : z.x;
          const ny = g.corner.includes("n") ? Math.min(p.y, z.y + z.h - 0.02) : z.y;
          const nw = g.corner.includes("w") ? z.x + z.w - nx : Math.max(0.02, p.x - z.x);
          const nh = g.corner.includes("n") ? z.y + z.h - ny : Math.max(0.02, p.y - z.y);
          return { ...z, x: clamp01(nx), y: clamp01(ny), w: Math.min(1, nw), h: Math.min(1, nh) };
        }));
        break;
      }
      case "zone-draw": {
        setDraftZone((d) => (d ? { ...d, to: p } : d));
        break;
      }
      case "freehand": {
        setDraftFree((pts) => {
          if (!pts) return pts;
          const last = pts[pts.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) < 0.008) return pts;
          return [...pts, p];
        });
        break;
      }
      case "maybe-marquee": {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) {
          gesture.current = { type: "marquee", start: g.start };
          setMarquee({ x1: g.start.x, y1: g.start.y, x2: p.x, y2: p.y });
        }
        break;
      }
      case "marquee": {
        setMarquee((m) => (m ? { ...m, x2: p.x, y2: p.y } : m));
        break;
      }
      default:
        break;
    }
  };

  const onSvgPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    clearLongPress();
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; return; }
    const g = gesture.current;
    gesture.current = null;
    setGuides([]);
    if (!g) return;
    switch (g.type) {
      case "pan": {
        // Plain click on the background deselects.
        if (!g.moved) setSel([]);
        break;
      }
      case "drag-token": {
        // Dragged off the pitch → delete (TacticalPad).
        const r = rectOfSvg();
        const outside = !r || e.clientX < r.left - 8 || e.clientX > r.right + 8 || e.clientY < r.top - 8 || e.clientY > r.bottom + 8;
        if (outside) removeIds([g.id]);
        break;
      }
      case "bend": {
        // Released almost on the straight line → straighten it back.
        setArrows((as) => as.map((a) => {
          if (a.id !== g.id || !a.bend) return a;
          const mx = (a.from.x + a.to.x) / 2, my = (a.from.y + a.to.y) / 2;
          const d = Math.hypot((a.bend.x - mx) * VB_W, (a.bend.y - my) * pitchH);
          return d < 10 ? { ...a, bend: undefined } : a;
        }));
        break;
      }
      case "zone-draw": {
        const dz = draftZone;
        setDraftZone(null);
        if (dz && (Math.abs(dz.to.x - dz.from.x) > 0.02 || Math.abs(dz.to.y - dz.from.y) > 0.02)) {
          snapshot();
          if (dz.shape === "circle") {
            const cx = (dz.from.x + dz.to.x) / 2, cy = (dz.from.y + dz.to.y) / 2;
            const r = Math.max(0.02, Math.hypot(dz.to.x - dz.from.x, dz.to.y - dz.from.y) / 2);
            setZones((zs) => [...zs, { id: rid(), shape: "circle", x: cx, y: cy, r }]);
          } else {
            const x = Math.min(dz.from.x, dz.to.x), y = Math.min(dz.from.y, dz.to.y);
            setZones((zs) => [...zs, { id: rid(), shape: "rect", x, y, w: Math.abs(dz.to.x - dz.from.x), h: Math.abs(dz.to.y - dz.from.y) }]);
          }
        }
        setArmed(null);
        break;
      }
      case "freehand": {
        const pts = draftFree;
        setDraftFree(null);
        if (pts && pts.length > 2) {
          snapshot();
          setArrows((as) => [...as, { id: rid(), kind: "freehand", from: pts[0], to: pts[pts.length - 1], points: pts, color: arrowColor }]);
        }
        setArmed(null);
        break;
      }
      case "maybe-marquee": {
        setSel([]);
        break;
      }
      case "marquee": {
        const m = marquee;
        setMarquee(null);
        if (m) {
          const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2);
          const y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
          const ids = [
            ...tokens.filter((t) => t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2).map((t) => t.id),
            ...zones.filter((z) => {
              const cx = z.shape === "circle" ? z.x : z.x + z.w / 2;
              const cy = z.shape === "circle" ? z.y : z.y + z.h / 2;
              return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2;
            }).map((z) => z.id),
          ];
          setSel(ids);
        }
        break;
      }
      default:
        break;
    }
  };

  const onSvgDoubleClick = (e) => {
    const tokEl = e.target.closest?.("[data-tid]");
    const arrEl = e.target.closest?.("[data-aid]");
    if (tokEl || arrEl) setFocusInspector(true);
  };

  // ── keyboard ─────────────────────────────────────────────────────────────
  // The once-mounted key handlers read the latest callbacks through this
  // ref so they never go stale (assigned in an effect, not during render).
  const api = useRef({});
  useEffect(() => {
    api.current = {
      undo, redo, removeSelected, duplicateSelection,
      nudge: (dx, dy) => {
        if (!sel.length) return;
        snapshot();
        setTokens((ts) => ts.map((t) => (sel.includes(t.id) ? { ...t, x: clamp01(t.x + dx), y: clamp01(t.y + dy) } : t)));
        setZones((zs) => zs.map((z) => {
          if (!sel.includes(z.id)) return z;
          if (z.shape === "circle") return { ...z, x: clamp01(z.x + dx), y: clamp01(z.y + dy) };
          return { ...z, x: clamp01(z.x + dx), y: clamp01(z.y + dy) };
        }));
      },
      sel,
    };
  });
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      const a = api.current;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) a.redo(); else a.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); a.redo(); return; }
      if (e.key === " ") { spaceDown.current = true; e.preventDefault(); return; }
      if (e.key === "Alt") { altDown.current = true; return; }
      if (e.key === "Escape") {
        if (aim) { setAim(null); setArmed(null); }
        else if (armed) setArmed(null);
        else if (sel.length) setSel([]);
        else onClose?.();
        return;
      }
      const r = rectOfSvg();
      const stepX = r ? (e.shiftKey ? 10 : 1) / r.width : 0.002;
      const stepY = r ? (e.shiftKey ? 10 : 1) / r.height : 0.002;
      switch (e.key.toLowerCase()) {
        case "v": setArmed(null); break;
        case "a": setArmed({ tool: "arrow", kind: lastArrowKind.current }); break;
        case "delete": case "backspace": if (a.sel.length) a.removeSelected(); break;
        case "d": if (a.sel.length) a.duplicateSelection(); break;
        case "g": setShowGrid((g) => !g); break;
        case "s": setSnapOn((s) => !s); break;
        case "arrowleft": e.preventDefault(); a.nudge(-stepX, 0); break;
        case "arrowright": e.preventDefault(); a.nudge(stepX, 0); break;
        case "arrowup": e.preventDefault(); a.nudge(0, -stepY); break;
        case "arrowdown": e.preventDefault(); a.nudge(0, stepY); break;
        default: break;
      }
    };
    const onKeyUp = (e) => {
      if (e.key === " ") spaceDown.current = false;
      if (e.key === "Alt") altDown.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── toolbar actions ──────────────────────────────────────────────────────
  const armArrow = (kind) => {
    lastArrowKind.current = kind;
    if (armed?.tool === "arrow" && armed.kind === kind) {
      // Repeat-tap cycles the arrow colour (SoccerBlade).
      const i = ARROW_COLORS.indexOf(arrowColor);
      setArrowColor(ARROW_COLORS[(i + 1) % ARROW_COLORS.length]);
    } else {
      setArmed({ tool: "arrow", kind });
      setAim(null);
    }
  };

  // ── selection panel data ─────────────────────────────────────────────────
  const selItems = sel.map((id) => findSel(id)).filter(Boolean);
  const selToken = selItems.length === 1 && selItems[0].type === "token" ? selItems[0].item : null;
  const selArrow = selItems.length === 1 && selItems[0].type === "arrow" ? selItems[0].item : null;
  const selZone = selItems.length === 1 && selItems[0].type === "zone" ? selItems[0].item : null;
  const hint = aim ? "Click where it ends — then drag the dot to bend it"
    : armed?.tool === "place" ? `Tap the pitch to place a ${armed.kind} — or drag it in`
    : armed?.tool === "arrow" ? `Click where the ${armed.kind} starts, then where it ends`
    : armed?.tool === "zone" ? "Drag on the pitch to draw the zone"
    : selItems.length > 1 ? `${selItems.length} selected — align or spread them from the panel`
    : selItems.length === 1 ? "Drag to move · drag off the pitch to delete · double-click to edit"
    : "Drag to move · V move · A arrow · ⌘Z undo · drag off the pitch to delete";

  const o = origin(view);
  const aimLockToken = aim?.lockId ? tokens.find((t) => t.id === aim.lockId) : null;

  const rotateToken = (id, deg) => {
    snapshot();
    setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, rot: (((t.rot || 0) + deg) % 360 + 360) % 360 } : t)));
  };
  const setArrowColorOf = (id, color) => setArrows((as) => as.map((a) => (a.id === id ? { ...a, color } : a)));
  const setArrowKindOf = (id, kind) => setArrows((as) => as.map((a) => (a.id === id ? { ...a, kind } : a)));
  const straightenArrow = (id) => setArrows((as) => as.map((a) => (a.id === id ? { ...a, bend: undefined } : a)));
  const setZoneShape = (id, shape) => setZones((zs) => zs.map((z) => {
    if (z.id !== id || z.shape === shape) return z;
    if (shape === "circle") return { ...z, shape: "circle", x: z.x + z.w / 2, y: z.y + z.h / 2, r: Math.max(0.02, Math.min(z.w, z.h) / 2) };
    const r = z.r || 0.05;
    return { ...z, shape: "rect", x: z.x - r, y: z.y - r, w: r * 2, h: r * 2 };
  }));

  const toolBtn = (active) => `flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 whitespace-nowrap ${active ? "text-white ring-2 ring-sky-400" : "text-white/70 bg-white/10 hover:bg-white/20"}`;
  const iconBtn = (active) => `min-w-10 min-h-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${active ? "text-white bg-sky-500" : "text-white bg-white/10 hover:bg-white/20"}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col text-white" onContextMenu={(e) => e.preventDefault()}>
      {/* top bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-white/10 overflow-x-auto flex-nowrap shrink-0">
        <span className="text-sm font-bold whitespace-nowrap max-w-32 truncate" title={title}>{title}</span>
        <select value={field} onChange={(e) => changeField(e.target.value)} aria-label="Pitch size" className="text-[11px] font-semibold bg-white/10 text-white rounded-lg px-2 py-2 outline-none cursor-pointer shrink-0">
          {BOARD_PRESETS.map((p) => <option key={p.id} value={p.id} className="text-slate-900">{p.label}</option>)}
        </select>
        <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap shrink-0">{lengthYd} × {widthYd} yd</span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => zoomAround(base.cw / 2, base.ch / 2, 1 / 1.25)} aria-label="Zoom out" className={iconBtn(false)}><ZoomOut className="w-4 h-4" /></button>
          <button onClick={fitView} title="Fit to screen" className="text-[11px] font-bold text-white/80 w-12 text-center shrink-0">{Math.round(zoom * 100)}%</button>
          <button onClick={() => zoomAround(base.cw / 2, base.ch / 2, 1.25)} aria-label="Zoom in" className={iconBtn(false)}><ZoomIn className="w-4 h-4" /></button>
          <button onClick={fitView} title="Fit to screen" aria-label="Fit to screen" className={iconBtn(false)}><Maximize className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo" className={iconBtn(false)}><Undo2 className="w-4 h-4" /></button>
          <button onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" className={iconBtn(false)}><Redo2 className="w-4 h-4" /></button>
        </div>
        <button onClick={() => setSnapOn((s) => !s)} aria-pressed={snapOn} title="Snap to objects & pitch lines (S)" className={iconBtn(snapOn)}><Magnet className="w-4 h-4" /></button>
        <button onClick={() => setShowGrid((g) => !g)} aria-pressed={showGrid} title="Show 5-yard grid (G)" className={iconBtn(showGrid)}><LayoutGrid className="w-4 h-4" /></button>
        <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
          <button onClick={save} disabled={busy} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-full text-white min-h-11 disabled:opacity-50" style={{ backgroundColor: TEAM_COLORS.focus }}><Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save"}</button>
          <button onClick={onClose} aria-label="Close board" className={iconBtn(false)}><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* grid dimensions (only for the Grid preset) */}
      {field === "grid" && (
        <div className="px-4 py-2 bg-slate-800/60 border-b border-white/10 flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-white/60">Grid size</span>
          <label className="flex items-center gap-1 text-[11px] font-semibold text-white">
            <input type="number" min={5} max={130} value={lengthYd} onChange={(e) => changeDims(e.target.value, widthYd)} className="w-16 bg-white/10 text-white text-xs font-bold text-center rounded-lg px-2 py-2 border border-white/15 outline-none" /> yd long
          </label>
          <span className="text-white/40 text-xs">×</span>
          <label className="flex items-center gap-1 text-[11px] font-semibold text-white">
            <input type="number" min={5} max={130} value={widthYd} onChange={(e) => changeDims(lengthYd, e.target.value)} className="w-16 bg-white/10 text-white text-xs font-bold text-center rounded-lg px-2 py-2 border border-white/15 outline-none" /> yd wide
          </label>
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 min-h-0 overflow-hidden bg-slate-950 order-1 md:order-2 touch-none select-none"
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
          onDoubleClick={onSvgDoubleClick}
        >
          <div style={{ position: "absolute", left: o.x, top: o.y, width: base.w, height: base.h, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
            <svg
              ref={svgRef}
              width={base.w}
              height={base.h}
              viewBox={`0 0 ${VB_W} ${pitchH}`}
              className="block touch-none select-none"
              style={{ width: base.w, height: base.h }}
            >
              <defs><ArrowMarkers /></defs>
              <g data-pitch="1"><PitchMarks preset={preset} wYd={wYd} dYd={dYd} pitchH={pitchH} /></g>

              {/* faint 5-yard grid — a backdrop only, never the snap mechanism */}
              {showGrid && (
                <g style={{ pointerEvents: "none" }}>
                  {Array.from({ length: Math.floor(wYd / 5) + 1 }).map((_, i) => {
                    const x = M + (i * 5 / wYd) * (VB_W - 2 * M);
                    return <line key={`gx${i}`} x1={x} y1={M} x2={x} y2={pitchH - M} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />;
                  })}
                  {Array.from({ length: Math.floor(dYd / 5) + 1 }).map((_, i) => {
                    const y = M + (i * 5 / dYd) * (pitchH - 2 * M);
                    return <line key={`gy${i}`} x1={M} y1={y} x2={VB_W - M} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />;
                  })}
                </g>
              )}

              {/* zones */}
              {zones.map((z) => {
                const selected = sel.includes(z.id);
                const stroke = selected ? "#38BDF8" : "rgba(255,255,255,0.7)";
                if (z.shape === "circle") return (
                  <g key={z.id} data-zid={z.id} style={{ cursor: "grab" }}>
                    <circle cx={px(z.x)} cy={py(z.y)} r={(z.r || 0.05) * (VB_W - 2 * M)} fill="rgba(255,255,255,0.12)" stroke={stroke} strokeWidth={2.5} strokeDasharray="8 6" />
                    {selected && (
                      <rect x={px(z.x) + (z.r || 0.05) * (VB_W - 2 * M) - 7} y={py(z.y) - 7} width={14} height={14} rx={3} fill="#38BDF8" stroke="#fff" strokeWidth={2} data-resize={`${z.id}:e`} style={{ cursor: "ew-resize" }} />
                    )}
                  </g>
                );
                return (
                  <g key={z.id} data-zid={z.id} style={{ cursor: "grab" }}>
                    <rect x={px(z.x)} y={py(z.y)} width={z.w * (VB_W - 2 * M)} height={z.h * (pitchH - 2 * M)} rx={6} fill="rgba(255,255,255,0.12)" stroke={stroke} strokeWidth={2.5} strokeDasharray="8 6" />
                    {selected && [["nw", px(z.x), py(z.y)], ["ne", px(z.x + z.w), py(z.y)], ["sw", px(z.x), py(z.y + z.h)], ["se", px(z.x + z.w), py(z.y + z.h)]].map(([c, hx, hy]) => (
                      <rect key={c} x={hx - 7} y={hy - 7} width={14} height={14} rx={3} fill="#38BDF8" stroke="#fff" strokeWidth={2} data-resize={`${z.id}:${c}`} style={{ cursor: "nwse-resize" }} />
                    ))}
                  </g>
                );
              })}

              {/* arrows — numbered in draw order */}
              {arrows.map((a, i) => (
                <ArrowShape key={a.id} a={a} index={i} px={px} py={py} interactive selected={sel.includes(a.id)} />
              ))}

              {/* tokens */}
              {tokens.map((t) => {
                const x = px(t.x), y = py(t.y);
                const selected = sel.includes(t.id);
                const half = TOKEN_HALF[t.kind] || 19;
                return (
                  <g key={t.id} data-tid={t.id} style={{ cursor: "grab" }}>
                    <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                    {selected && <circle cx={x} cy={y} r={half + 8} fill="none" stroke="#38BDF8" strokeWidth={3} strokeDasharray="3 3" style={{ pointerEvents: "none" }} />}
                    <TokenGlyph t={t} x={x} y={y} />
                    {selected && EQUIPMENT_KINDS.has(t.kind) && (
                      <g>
                        <line x1={x} y1={y - half - 4} x2={x} y2={y - half - 26} stroke="#38BDF8" strokeWidth={2} style={{ pointerEvents: "none" }} />
                        <circle cx={x} cy={y - half - 30} r={11} fill="#0F172A" stroke="#38BDF8" strokeWidth={2.5} data-rotate={t.id} style={{ cursor: "grab" }} />
                        <text x={x} y={y - half - 26} textAnchor="middle" fontSize={13} fontWeight="800" fill="#38BDF8" style={{ pointerEvents: "none" }}>↻</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* arrow aim ghost (click start → click end, live preview) */}
              {aim && (
                <g style={{ pointerEvents: "none" }}>
                  {aim.kind === "dribble"
                    ? <path d={wavyPath(px(aim.from.x), py(aim.from.y), px(aim.to.x), py(aim.to.y))} fill="none" stroke={arrowColor} strokeWidth={4} strokeLinecap="round" opacity={0.7} />
                    : <line x1={px(aim.from.x)} y1={py(aim.from.y)} x2={px(aim.to.x)} y2={py(aim.to.y)} stroke={arrowColor} strokeWidth={4} strokeLinecap="round" strokeDasharray={aim.kind === "run" || aim.kind === "curve" ? "10 7" : undefined} opacity={0.7} />}
                  <circle cx={px(aim.to.x)} cy={py(aim.to.y)} r={8} fill="none" stroke={arrowColor} strokeWidth={2.5} />
                  {aimLockToken && <circle cx={px(aimLockToken.x)} cy={py(aimLockToken.y)} r={R + 6} fill="none" stroke="#38BDF8" strokeWidth={3} />}
                </g>
              )}

              {/* zone draft */}
              {draftZone && (draftZone.shape === "circle"
                ? <circle cx={px((draftZone.from.x + draftZone.to.x) / 2)} cy={py((draftZone.from.y + draftZone.to.y) / 2)} r={Math.hypot(draftZone.to.x - draftZone.from.x, draftZone.to.y - draftZone.from.y) / 2 * (VB_W - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2.5} strokeDasharray="8 6" style={{ pointerEvents: "none" }} />
                : <rect x={px(Math.min(draftZone.from.x, draftZone.to.x))} y={py(Math.min(draftZone.from.y, draftZone.to.y))} width={Math.abs(draftZone.to.x - draftZone.from.x) * (VB_W - 2 * M)} height={Math.abs(draftZone.to.y - draftZone.from.y) * (pitchH - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2.5} strokeDasharray="8 6" rx={6} style={{ pointerEvents: "none" }} />)}

              {/* freehand draft */}
              {draftFree && draftFree.length > 1 && (
                <polyline points={draftFree.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} fill="none" stroke={arrowColor} strokeWidth={4} strokeLinecap="round" style={{ pointerEvents: "none" }} />
              )}

              {/* live smart guides — red lines where things line up */}
              {guides.map((g, i) => g.axis === "x"
                ? <line key={i} x1={px(g.at)} y1={M} x2={px(g.at)} y2={pitchH - M} stroke="#EF4444" strokeWidth={2} style={{ pointerEvents: "none" }} />
                : <line key={i} x1={M} y1={py(g.at)} x2={VB_W - M} y2={py(g.at)} stroke="#EF4444" strokeWidth={2} style={{ pointerEvents: "none" }} />)}

              {/* marquee selection */}
              {marquee && (
                <rect x={px(Math.min(marquee.x1, marquee.x2))} y={py(Math.min(marquee.y1, marquee.y2))}
                  width={Math.abs(marquee.x2 - marquee.x1) * (VB_W - 2 * M)} height={Math.abs(marquee.y2 - marquee.y1) * (pitchH - 2 * M)}
                  fill="rgba(56,189,248,0.08)" stroke="#38BDF8" strokeWidth={2} strokeDasharray="6 4" style={{ pointerEvents: "none" }} />
              )}
            </svg>
          </div>
        </div>

        {/* palette — left rail on desktop, bottom sheet on phone */}
        <aside className="order-2 md:order-1 bg-slate-900 border-t md:border-t-0 md:border-r border-white/10 flex md:flex-col items-center gap-1.5 px-2 py-2 md:py-3 overflow-x-auto md:overflow-y-auto md:w-[76px] shrink-0">
          {PALETTE.map((p) => (
            <button key={p.kind}
              onPointerDown={(e) => onPaletteDown(e, p.kind)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setArmed((a) => (a?.tool === "place" && a.kind === p.kind ? null : { tool: "place", kind: p.kind })); } }}
              aria-pressed={armed?.tool === "place" && armed.kind === p.kind}
              title={`${p.label} — drag onto the pitch, or tap then tap the pitch`}
              className={`min-w-12 min-h-12 w-12 h-12 md:w-14 md:h-14 rounded-xl flex flex-col items-center justify-center gap-0.5 shrink-0 ${armed?.tool === "place" && armed.kind === p.kind ? "bg-sky-500 text-white ring-2 ring-sky-300" : "bg-white/10 text-white hover:bg-white/20"}`}>
              <PaletteGlyph kind={p.kind} />
              <span className="text-[9px] font-bold leading-none">{p.label}</span>
            </button>
          ))}
        </aside>

        {/* selection inspector — right rail on desktop, sheet on phone.
            Always rendered on desktop so selecting never resizes the pitch
            mid-drag (a layout jump at grab time feels broken). */}
        <aside className={`order-3 w-full md:w-60 md:border-l border-t md:border-t-0 border-white/10 bg-slate-900 overflow-y-auto max-h-48 md:max-h-none p-3 space-y-3 shrink-0 ${selItems.length === 0 ? "hidden md:block" : ""}`}>
          {selItems.length > 0 ? (
            <>
            {selToken && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/40">Selected · {selToken.kind}</div>
                {(selToken.kind === "focus" || selToken.kind === "opp" || selToken.kind === "gk") && (
                  <label className="block text-xs font-bold text-white/70">Number / label
                    <input ref={labelInputRef} value={selToken.label || ""} onChange={(e) => setLabel(selToken.id, e.target.value)} maxLength={3} className="mt-1 w-20 bg-white/10 text-white text-sm font-bold text-center rounded-lg px-2 py-2 border border-white/15 outline-none" />
                  </label>
                )}
                {EQUIPMENT_KINDS.has(selToken.kind) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white/70">Rotate</span>
                    <button onClick={() => rotateToken(selToken.id, -45)} aria-label="Rotate left 45 degrees" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"><RotateCcw className="w-4 h-4" /></button>
                    <span className="text-xs font-bold text-white/80 w-10 text-center">{selToken.rot || 0}°</span>
                    <button onClick={() => rotateToken(selToken.id, 45)} aria-label="Rotate right 45 degrees" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"><RotateCw className="w-4 h-4" /></button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={duplicateSelection} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-white/10 text-white min-h-10"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                  <button onClick={removeSelected} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-red-500/80 text-white min-h-10"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            )}
            {selArrow && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/40">Selected · arrow {arrows.findIndex((a) => a.id === selArrow.id) + 1}</div>
                <div className="flex flex-wrap gap-1">
                  {["pass", "run", "dribble", "shot", "direction"].map((k) => (
                    <button key={k} onClick={() => setArrowKindOf(selArrow.id, k)} className={`text-[11px] font-bold px-2.5 py-2 rounded-full min-h-9 capitalize ${selArrow.kind === k ? "text-white bg-sky-500" : "text-white/70 bg-white/10"}`}>{k}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white/70">Colour</span>
                  {ARROW_COLORS.map((c) => (
                    <button key={c} onClick={() => setArrowColorOf(selArrow.id, c)} aria-label={`Arrow colour ${c}`} className={`w-8 h-8 rounded-full border-2 ${selArrow.color === c || (!selArrow.color && c === ARROW_WHITE) ? "border-sky-400" : "border-white/30"}`} style={{ background: c }} />
                  ))}
                </div>
                {selArrow.bend && (
                  <button onClick={() => straightenArrow(selArrow.id)} className="text-[11px] font-bold px-3 py-2 rounded-full bg-white/10 text-white min-h-9">Straighten arrow</button>
                )}
                <div className="flex gap-2">
                  <button onClick={duplicateSelection} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-white/10 text-white min-h-10"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                  <button onClick={removeSelected} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-red-500/80 text-white min-h-10"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            )}
            {selZone && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/40">Selected · zone</div>
                <div className="flex gap-1">
                  <button onClick={() => setZoneShape(selZone.id, "rect")} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full min-h-9 ${selZone.shape === "rect" ? "text-white bg-sky-500" : "text-white/70 bg-white/10"}`}><SquareDashed className="w-3.5 h-3.5" /> Rect</button>
                  <button onClick={() => setZoneShape(selZone.id, "circle")} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full min-h-9 ${selZone.shape === "circle" ? "text-white bg-sky-500" : "text-white/70 bg-white/10"}`}><CircleDashed className="w-3.5 h-3.5" /> Circle</button>
                </div>
                <div className="flex gap-2">
                  <button onClick={duplicateSelection} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-white/10 text-white min-h-10"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                  <button onClick={removeSelected} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-red-500/80 text-white min-h-10"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            )}
            {selItems.length > 1 && (
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/40">{selItems.length} selected</div>
                <div className="grid grid-cols-3 gap-1">
                  {[["left", "Left"], ["center", "Centre"], ["right", "Right"], ["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].map(([m, lbl]) => (
                    <button key={m} onClick={() => alignSel(m)} className="text-[11px] font-bold px-2 py-2 rounded-lg bg-white/10 text-white min-h-9">{lbl}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => alignSel("dist-h")} className="flex-1 text-[11px] font-bold px-2 py-2 rounded-full bg-white/10 text-white min-h-9">Spread ↔</button>
                  <button onClick={() => alignSel("dist-v")} className="flex-1 text-[11px] font-bold px-2 py-2 rounded-full bg-white/10 text-white min-h-9">Spread ↕</button>
                </div>
                <button onClick={removeSelected} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-red-500/80 text-white min-h-10"><Trash2 className="w-3.5 h-3.5" /> Delete all</button>
              </div>
            )}
            </>
          ) : (
            <div className="hidden md:block text-xs text-white/40 leading-relaxed pt-1">
              Tap a player, arrow or zone to edit it here.
              <br />
              <span className="text-white/25">Drag the pitch to move around · scroll to zoom · V move · A arrow · Del delete</span>
            </div>
          )}
        </aside>
      </div>

      {/* arrow toolbar — one-shot tools: tap, draw one, back to Move */}
      <div className="bg-slate-900 border-t border-white/10 px-2 py-2 flex items-center gap-1.5 overflow-x-auto shrink-0">
        <button onClick={() => { setArmed(null); setAim(null); }} aria-pressed={!armed} title="Move / select (V)" className={`${toolBtn(!armed)} shrink-0`} style={!armed ? { backgroundColor: TEAM_COLORS.focus } : {}}><MousePointer2 className="w-4 h-4" /> Move</button>
        {ARROW_TOOLS.map((t) => (
          <button key={t.kind} onClick={() => armArrow(t.kind)} aria-pressed={armed?.tool === "arrow" && armed.kind === t.kind}
            title={t.kind === "curve" ? "Curved run — click start, click end, then drag the dot to bend it" : `${t.label} arrow — click start, then click end`}
            className={`${toolBtn(armed?.tool === "arrow" && armed.kind === t.kind)} shrink-0`} style={armed?.tool === "arrow" && armed.kind === t.kind ? { backgroundColor: TEAM_COLORS.focus } : {}}>
            <ArrowPreview kind={t.kind} /> {t.label}
          </button>
        ))}
        <span className="w-px h-8 bg-white/15 shrink-0 mx-1" />
        <button onClick={() => setArmed((a) => (a?.tool === "zone" && a.shape === "rect" ? null : { tool: "zone", shape: "rect" }))} aria-pressed={armed?.tool === "zone" && armed.shape === "rect"} title="Draw a rectangular zone" className={`${toolBtn(armed?.tool === "zone" && armed.shape === "rect")} shrink-0`} style={armed?.tool === "zone" && armed.shape === "rect" ? { backgroundColor: TEAM_COLORS.focus } : {}}><SquareDashed className="w-4 h-4" /> Zone</button>
        <button onClick={() => setArmed((a) => (a?.tool === "zone" && a.shape === "circle" ? null : { tool: "zone", shape: "circle" }))} aria-pressed={armed?.tool === "zone" && armed.shape === "circle"} title="Draw a circular zone" className={`${toolBtn(armed?.tool === "zone" && armed.shape === "circle")} shrink-0`} style={armed?.tool === "zone" && armed.shape === "circle" ? { backgroundColor: TEAM_COLORS.focus } : {}}><CircleDashed className="w-4 h-4" /> Circle</button>
        <span className="w-px h-8 bg-white/15 shrink-0 mx-1" />
        <span className="flex items-center gap-1.5 shrink-0" title="Arrow colour — tap an arrow tool twice to cycle">
          {ARROW_COLORS.map((c) => (
            <button key={c} onClick={() => setArrowColor(c)} aria-label={`Arrow colour ${c}`} className={`w-7 h-7 rounded-full border-2 ${arrowColor === c ? "border-sky-400" : "border-white/30"}`} style={{ background: c }} />
          ))}
        </span>
        <button onClick={clearBoard} className="ml-auto flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white/10 text-white min-h-11 shrink-0"><RotateCcw className="w-3.5 h-3.5" /> Clear</button>
      </div>

      {/* hint bar + legend */}
      <div className="bg-slate-900 border-t border-white/5 px-3 py-1.5 flex items-center gap-3 shrink-0">
        <span className="text-[11px] text-white/50 font-medium truncate">{hint}</span>
        <span className="hidden md:flex items-center gap-3 ml-auto shrink-0">
          {ARROW_LEGEND.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-white/60">
              <ArrowPreview kind={a.id} />
              {a.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/60">
            <Move className="w-3 h-3" /> drag to move
            <Hand className="w-3 h-3 ml-2" /> drag off to delete
          </span>
        </span>
      </div>

      {/* hidden read-only board — the PNG export renders from this, so the
          exported image is exactly what DrillCard/DrillDetail show. */}
      <div ref={exportRef} aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <BoardSvg state={state()} showLegend />
      </div>

      {/* palette drag ghost */}
      {ghost && (
        <div className="fixed z-[60] pointer-events-none" style={{ left: ghost.cx - 24, top: ghost.cy - 24 }}>
          <div className="w-12 h-12 rounded-xl bg-slate-800/90 border border-sky-400 flex items-center justify-center shadow-xl">
            <PaletteGlyph kind={ghost.kind} />
          </div>
        </div>
      )}
    </div>
  );
}
