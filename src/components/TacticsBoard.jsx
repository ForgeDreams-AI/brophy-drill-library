// ─── Practice Board (Option C — Diagram Studio First) ──────────────────────
// A to-scale pitch board for building drills. The drill is built ON the board:
// the coach places players, cones, goals, zones and arrows on a pitch whose
// dimensions are real yards, then the drill's setup fields are filled in from
// that. Works on desktop (mouse drag) AND phone (tap-to-place, big targets).
//
// Board state lives in ./boardData (v2, stored on the drill doc as
// `diagramData`). All positions are normalized 0..1 across the pitch area, so
// a board stays valid when the yard dimensions change.
//
// onSave(pngBlob, state) — pngBlob is a rasterized image saved as the drill
// diagram; state is the structured JSON above so the board is re-editable.

import { useRef, useState } from "react";
import {
  VB_W, LEG_H, clamp, BOARD_PRESETS, TEAM_COLORS, ARROW_LEGEND,
  wavyPath, normalizeBoardState, boardDims,
} from "./boardData";
import {
  X, Trash2, RotateCcw, Undo2, MousePointer2, Spline, Save,
  Copy, Magnet, Hand, SquareDashed, CircleDashed,
} from "lucide-react";

const M = 30;          // pitch inset margin
const R = 19;          // player token radius (board units)
const HIT_R = 30;      // invisible touch-hit radius around tokens
const rid = () => Math.random().toString(36).slice(2, 9);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ARROW_WHITE = "#FFFFFF"; // white arrows on the green pitch

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
    const boxW = preset.id === "box" ? wYd : 44, boxD = 18, sixW = 20, sixD = 6;
    return (
      <g>
        {bg}{stripes}{boundary}
        {goalBar(cx, M, true)}
        <rect x={X(cx - boxW / 2)} y={M} width={X(cx + boxW / 2) - X(cx - boxW / 2)} height={Y(boxD) - M} {...L} />
        <rect x={X(cx - sixW / 2)} y={M} width={X(cx + sixW / 2) - X(cx - sixW / 2)} height={Y(sixD) - M} {...L} />
        <circle cx={cx} cy={Y(12)} r={4} fill="rgba(255,255,255,0.85)" />
        {arc(cx, 12, boxD, false)}
        <line x1={M} y1={pitchH - M} x2={VB_W - M} y2={pitchH - M} {...L} strokeWidth={4} />
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

// Read-only render of a board state (thumbnails, session rows, PDFs). No
// editing chrome — just the pitch, zones, arrows and markers.
export function BoardSvg({ state, className = "", showLegend = false }) {
  const s = normalizeBoardState(state);
  const { preset, wYd, dYd, pitchH, vbH } = boardDims(s);
  const px = (x) => M + x * (VB_W - 2 * M);
  const py = (y) => M + y * (pitchH - 2 * M);
  return (
    <svg viewBox={`0 0 ${VB_W} ${showLegend ? vbH : pitchH}`} className={className} role="img" aria-label="Drill diagram">
      <defs>
        <marker id="bs-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_WHITE} />
        </marker>
        <marker id="bs-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0.5 0.5 L 9 5 L 0.5 9.5" fill="none" stroke={ARROW_WHITE} strokeWidth="1.8" strokeLinecap="round" />
        </marker>
      </defs>
      <PitchMarks preset={preset} wYd={wYd} dYd={dYd} pitchH={pitchH} />
      {s.zones.map((z) => (
        z.shape === "circle"
          ? <circle key={z.id} cx={px(z.x)} cy={py(z.y)} r={z.r * (VB_W - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeDasharray="8 6" />
          : <rect key={z.id} x={px(z.x)} y={py(z.y)} width={z.w * (VB_W - 2 * M)} height={z.h * (pitchH - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2} strokeDasharray="8 6" rx={6} />
      ))}
      {s.arrows.map((a) => {
        const p = { x1: px(a.from.x), y1: py(a.from.y), x2: px(a.to.x), y2: py(a.to.y) };
        if (a.kind === "dribble") return <path key={a.id} d={wavyPath(p.x1, p.y1, p.x2, p.y2)} fill="none" stroke={ARROW_WHITE} strokeWidth={3.5} strokeLinecap="round" markerEnd="url(#bs-head)" />;
        if (a.kind === "shot") {
          const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy) || 1, ox = (-dy / len) * 4, oy = (dx / len) * 4;
          return (
            <g key={a.id}>
              <line x1={p.x1 + ox} y1={p.y1 + oy} x2={p.x2 + ox} y2={p.y2 + oy} stroke={ARROW_WHITE} strokeWidth={2.5} strokeLinecap="round" />
              <line x1={p.x1 - ox} y1={p.y1 - oy} x2={p.x2 - ox} y2={p.y2 - oy} stroke={ARROW_WHITE} strokeWidth={2.5} strokeLinecap="round" markerEnd="url(#bs-head)" />
            </g>
          );
        }
        return (
          <line key={a.id} {...p} stroke={ARROW_WHITE} strokeWidth={a.kind === "pass" ? 3.5 : 4} strokeLinecap="round"
            strokeDasharray={a.kind === "run" ? "10 7" : undefined}
            markerEnd={a.kind === "pass" ? "url(#bs-open)" : "url(#bs-head)"} />
        );
      })}
      {s.tokens.map((t) => {
        const x = px(t.x), y = py(t.y);
        if (t.kind === "ball") return (
          <g key={t.id}>
            <circle cx={x} cy={y} r={12} fill="#fff" stroke="#111" strokeWidth={2} />
            <circle cx={x} cy={y} r={4.5} fill="#111" />
          </g>
        );
        if (t.kind === "cone") return (
          <polygon key={t.id} points={`${x},${y - 16} ${x - 13},${y + 12} ${x + 13},${y + 12}`} fill="#F97316" stroke="#7C2D12" strokeWidth={2} />
        );
        if (t.kind === "goal") return <GoalMark key={t.id} x={x} y={y} />;
        if (t.kind === "mannequin") return (
          <g key={t.id}>
            <rect x={x - 9} y={y - 18} width={18} height={36} rx={8} fill="#94A3B8" stroke="#475569" strokeWidth={2} />
            <rect x={x - 13} y={y + 16} width={26} height={5} rx={2.5} fill="#64748B" />
          </g>
        );
        return (
          <g key={t.id}>
            <circle cx={x} cy={y} r={R} fill={TEAM_COLORS[t.kind] || "#64748B"} stroke="rgba(0,0,0,0.4)" strokeWidth={2} />
            {t.label ? <text x={x} y={y + R * 0.34} textAnchor="middle" fontSize={R * 0.85} fontWeight="700" fill="#fff" style={{ pointerEvents: "none" }}>{t.label}</text> : null}
          </g>
        );
      })}
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
          ? <path d={wavyPath(x1, cy, x2, cy, 5, 14)} fill="none" stroke={ARROW_WHITE} strokeWidth={3} strokeLinecap="round" markerEnd="url(#bs-head)" />
          : it.kind === "shot"
            ? <g><line x1={x1} y1={cy - 4} x2={x2} y2={cy - 4} stroke={ARROW_WHITE} strokeWidth={2} /><line x1={x1} y1={cy + 4} x2={x2} y2={cy + 4} stroke={ARROW_WHITE} strokeWidth={2} markerEnd="url(#bs-head)" /></g>
            : <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={ARROW_WHITE} strokeWidth={3.5} strokeLinecap="round" strokeDasharray={it.kind === "run" ? "9 6" : undefined} markerEnd={it.kind === "pass" ? "url(#bs-open)" : "url(#bs-head)"} />;
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

export default function TacticsBoard({ initial, onSave, onClose }) {
  const init = normalizeBoardState(initial);
  const svgRef = useRef(null);
  const [field, setField] = useState(init.field);
  const [lengthYd, setLengthYd] = useState(init.lengthYd);
  const [widthYd, setWidthYd] = useState(init.widthYd);
  const [tokens, setTokens] = useState(init.tokens);
  const [arrows, setArrows] = useState(init.arrows);
  const [zones, setZones] = useState(init.zones);
  const [mode, setMode] = useState("move");       // move | draw | place
  const [drawKind, setDrawKind] = useState("run"); // pass | run | dribble | shot | direction | zone
  const [placeKind, setPlaceKind] = useState(null); // token kind being placed
  const [snap, setSnap] = useState(false);
  const [selId, setSelId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const dragId = useRef(null);
  const dragKind = useRef(null); // 'token' | 'zone'
  const drawFrom = useRef(null);
  const moved = useRef(false);
  const undoStack = useRef([]);

  const dims = boardDims({ field, lengthYd, widthYd });
  const { pitchH, vbH } = dims;
  const state = () => ({ field, lengthYd, widthYd, tokens, arrows, zones });

  const snapshot = () => {
    undoStack.current.push({ field, lengthYd, widthYd, tokens, arrows, zones });
    if (undoStack.current.length > 60) undoStack.current.shift();
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setField(prev.field); setLengthYd(prev.lengthYd); setWidthYd(prev.widthYd);
    setTokens(prev.tokens); setArrows(prev.arrows); setZones(prev.zones || []); setSelId(null);
  };

  const snapPt = (p) => (snap ? { x: clamp01(Math.round(p.x / 0.05) * 0.05), y: clamp01(Math.round(p.y / 0.05) * 0.05) } : p);
  const toBoard = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    // The SVG includes the legend strip at the bottom; map only the pitch area.
    const pitchPx = (r.height * pitchH) / vbH;
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / pitchPx) };
  };

  const nextLabel = (kind) => {
    if (kind === "focus" || kind === "opp") return String(tokens.filter((t) => t.kind === kind).length + 1);
    if (kind === "gk") return "GK";
    return "";
  };
  const placeToken = (kind, p) => {
    snapshot();
    const pt = snapPt(p);
    setTokens((ts) => [...ts, { id: rid(), kind, x: pt.x, y: pt.y, label: nextLabel(kind) }]);
  };
  const changeField = (f) => {
    const preset = BOARD_PRESETS.find((p) => p.id === f);
    snapshot();
    setField(f);
    setLengthYd(preset.lengthYd);
    setWidthYd(preset.widthYd);
  };
  const changeDims = (len, wid) => {
    setLengthYd(clamp(Number(len) || 10, 5, 130));
    setWidthYd(clamp(Number(wid) || 10, 5, 130));
  };

  const onTokenDown = (e, t) => {
    e.stopPropagation();
    if (mode !== "move") { setSelId(t.id); return; }
    e.preventDefault();
    dragId.current = t.id; dragKind.current = "token";
    moved.current = false;
    setSelId(t.id);
    svgRef.current.setPointerCapture?.(e.pointerId);
  };
  const onZoneDown = (e, z) => {
    e.stopPropagation();
    if (mode !== "move") { setSelId(z.id); return; }
    e.preventDefault();
    dragId.current = z.id; dragKind.current = "zone";
    moved.current = false;
    setSelId(z.id);
    svgRef.current.setPointerCapture?.(e.pointerId);
  };
  const onArrowDown = (e, a) => {
    e.stopPropagation();
    if (mode === "move") setSelId(a.id);
  };
  const onBoardDown = (e) => {
    if (mode === "draw") {
      const p = toBoard(e);
      drawFrom.current = p;
      setDraft({ from: p, to: p });
      svgRef.current.setPointerCapture?.(e.pointerId);
    } else if (mode === "place" && placeKind) {
      placeToken(placeKind, toBoard(e));
    } else if (e.target === svgRef.current || e.target.dataset?.pitch) {
      setSelId(null);
    }
  };
  const onMove = (e) => {
    if (dragId.current && dragKind.current === "token") {
      if (!moved.current) { moved.current = true; snapshot(); }
      const p = toBoard(e);
      setTokens((ts) => ts.map((t) => (t.id === dragId.current ? { ...t, x: p.x, y: p.y } : t)));
    } else if (dragId.current && dragKind.current === "zone") {
      if (!moved.current) { moved.current = true; snapshot(); }
      const p = toBoard(e);
      setZones((zs) => zs.map((z) => {
        if (z.id !== dragId.current) return z;
        if (z.shape === "circle") return { ...z, x: p.x, y: p.y };
        return { ...z, x: clamp01(p.x - z.w / 2), y: clamp01(p.y - z.h / 2) };
      }));
    } else if (drawFrom.current) {
      setDraft({ from: drawFrom.current, to: toBoard(e) });
    }
  };
  const onUp = () => {
    if (dragId.current && snap) {
      const id = dragId.current;
      setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, ...snapPt(t) } : t)));
      setZones((zs) => zs.map((z) => (z.id === id ? { ...z, x: Math.round(z.x / 0.05) * 0.05, y: Math.round(z.y / 0.05) * 0.05 } : z)));
    }
    dragId.current = null; dragKind.current = null; moved.current = false;
    if (drawFrom.current && draft) {
      const dx = draft.to.x - draft.from.x, dy = draft.to.y - draft.from.y;
      if (Math.hypot(dx, dy) > 0.03) {
        snapshot();
        if (drawKind === "zone") {
          const x = Math.min(draft.from.x, draft.to.x), y = Math.min(draft.from.y, draft.to.y);
          setZones((zs) => [...zs, { id: rid(), shape: "rect", x, y, w: Math.abs(dx), h: Math.abs(dy) }]);
        } else {
          setArrows((as) => [...as, { id: rid(), kind: drawKind, from: draft.from, to: draft.to }]);
        }
      }
    }
    drawFrom.current = null;
    setDraft(null);
  };

  const selToken = tokens.find((t) => t.id === selId) || null;
  const selZone = zones.find((z) => z.id === selId) || null;
  const selArrow = arrows.find((a) => a.id === selId) || null;
  const sel = selToken || selZone || selArrow;

  const removeSelected = () => {
    if (!selId) return;
    snapshot();
    setTokens((ts) => ts.filter((t) => t.id !== selId));
    setArrows((as) => as.filter((a) => a.id !== selId));
    setZones((zs) => zs.filter((z) => z.id !== selId));
    setSelId(null);
  };
  const duplicateSelected = () => {
    if (!selToken && !selZone) return;
    snapshot();
    if (selToken) {
      const copy = { ...selToken, id: rid(), x: clamp01(selToken.x + 0.06), y: clamp01(selToken.y + 0.06), label: nextLabel(selToken.kind) };
      setTokens((ts) => [...ts, copy]); setSelId(copy.id);
    } else if (selZone) {
      const copy = { ...selZone, id: rid(), x: clamp01(selZone.x + 0.05), y: clamp01(selZone.y + 0.05) };
      setZones((zs) => [...zs, copy]); setSelId(copy.id);
    }
  };
  const setLabel = (id, label) => setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, label: label.slice(0, 3) } : t)));
  const clearBoard = () => { snapshot(); setTokens([]); setArrows([]); setZones([]); setSelId(null); };

  // Rasterize the current board (minus editing chrome) to a PNG blob.
  const exportPng = () => new Promise((resolve, reject) => {
    const node = svgRef.current.cloneNode(true);
    node.setAttribute("width", VB_W);
    node.setAttribute("height", vbH);
    node.querySelectorAll("[data-skip]").forEach((n) => n.remove());
    const xml = new XMLSerializer().serializeToString(node);
    const src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = VB_W * scale; canvas.height = vbH * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = src;
  });

  const save = async () => {
    setBusy(true);
    setSelId(null);
    try {
      const blob = await exportPng();
      await onSave?.(blob, state());
    } catch {
      await onSave?.(null, state());
    } finally {
      setBusy(false);
    }
  };

  const px = (x) => M + x * (VB_W - 2 * M);
  const py = (y) => M + y * (pitchH - 2 * M);
  const arrowPx = (a) => ({ x1: px(a.from.x), y1: py(a.from.y), x2: px(a.to.x), y2: py(a.to.y) });

  const PLACE_BTNS = [
    ["focus", "Focus", TEAM_COLORS.focus],
    ["opp", "Opp", TEAM_COLORS.opp],
    ["gk", "GK", TEAM_COLORS.gk],
    ["ball", "Ball", "#FFFFFF"],
    ["cone", "Cone", "#F97316"],
    ["goal", "Goal", "#FFFFFF"],
    ["mannequin", "Mannequin", "#94A3B8"],
  ];
  const DRAW_BTNS = [
    ["pass", "Pass"], ["run", "Run"], ["dribble", "Dribble"], ["shot", "Shot"], ["direction", "Direction"], ["zone", "Zone"],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-slate-900 w-full sm:max-w-lg sm:rounded-3xl overflow-hidden flex flex-col max-h-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white text-sm font-bold flex-shrink-0">Board</span>
            <select value={field} onChange={(e) => changeField(e.target.value)} aria-label="Pitch size" className="text-[11px] font-semibold bg-white/10 text-white rounded px-1.5 py-1 outline-none cursor-pointer">
              {BOARD_PRESETS.map((p) => <option key={p.id} value={p.id} className="text-slate-900">{p.label}</option>)}
            </select>
            <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap">{lengthYd} × {widthYd} yd</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={busy} title="Undo" aria-label="Undo" className="min-w-11 min-h-11 w-11 h-11 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 disabled:opacity-30"><Undo2 className="w-4 h-4" /></button>
            <button onClick={save} disabled={busy} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full text-white min-h-11" style={{ backgroundColor: TEAM_COLORS.focus }}><Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save"}</button>
            <button onClick={onClose} aria-label="Close board" className="min-w-11 min-h-11 w-11 h-11 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* grid dimensions (only for the Grid preset) */}
        {field === "grid" && (
          <div className="px-4 py-2 bg-slate-800/60 border-b border-white/10 flex items-center gap-2">
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

        {/* board */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${vbH}`}
            className="w-full max-w-sm rounded-xl shadow-2xl touch-none select-none"
            style={{ aspectRatio: `${VB_W} / ${vbH}` }}
            onPointerDown={onBoardDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <defs>
              <marker id="tb-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_WHITE} />
              </marker>
              <marker id="tb-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M 0.5 0.5 L 9 5 L 0.5 9.5" fill="none" stroke={ARROW_WHITE} strokeWidth="1.8" strokeLinecap="round" />
              </marker>
              {/* bs-* ids are what LegendStrip uses (same shapes, so the strip
                  exports with the PNG from either SVG). */}
              <marker id="bs-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_WHITE} />
              </marker>
              <marker id="bs-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M 0.5 0.5 L 9 5 L 0.5 9.5" fill="none" stroke={ARROW_WHITE} strokeWidth="1.8" strokeLinecap="round" />
              </marker>
            </defs>
            <g data-pitch="1"><PitchMarks preset={dims.preset} wYd={dims.wYd} dYd={dims.dYd} pitchH={pitchH} /></g>

            {/* zones */}
            {zones.map((z) => {
              const onDown = (e) => onZoneDown(e, z);
              const selected = z.id === selId;
              return z.shape === "circle" ? (
                <circle key={z.id} cx={px(z.x)} cy={py(z.y)} r={z.r * (VB_W - 2 * M)} fill="rgba(255,255,255,0.12)" stroke={selected ? "#38BDF8" : "rgba(255,255,255,0.7)"} strokeWidth={2.5} strokeDasharray="8 6" onPointerDown={onDown} style={{ cursor: "grab" }} />
              ) : (
                <rect key={z.id} x={px(z.x)} y={py(z.y)} width={z.w * (VB_W - 2 * M)} height={z.h * (pitchH - 2 * M)} rx={6} fill="rgba(255,255,255,0.12)" stroke={selected ? "#38BDF8" : "rgba(255,255,255,0.7)"} strokeWidth={2.5} strokeDasharray="8 6" onPointerDown={onDown} style={{ cursor: "grab" }} />
              );
            })}

            {/* arrows */}
            {arrows.map((a) => {
              const p = arrowPx(a);
              const selected = a.id === selId;
              const onDown = (e) => onArrowDown(e, a);
              const halo = selected ? { stroke: "#38BDF8", strokeWidth: 8, opacity: 0.35 } : null;
              if (a.kind === "dribble") {
                return (
                  <g key={a.id}>
                    {halo && <path d={wavyPath(p.x1, p.y1, p.x2, p.y2)} fill="none" {...halo} strokeLinecap="round" />}
                    <path d={wavyPath(p.x1, p.y1, p.x2, p.y2)} fill="none" stroke={ARROW_WHITE} strokeWidth={3.5} strokeLinecap="round" markerEnd="url(#tb-head)" onPointerDown={onDown} style={{ cursor: "pointer" }} />
                  </g>
                );
              }
              if (a.kind === "shot") {
                const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy) || 1, ox = (-dy / len) * 4, oy = (dx / len) * 4;
                return (
                  <g key={a.id} onPointerDown={onDown} style={{ cursor: "pointer" }}>
                    <line x1={p.x1 + ox} y1={p.y1 + oy} x2={p.x2 + ox} y2={p.y2 + oy} stroke={ARROW_WHITE} strokeWidth={2.5} strokeLinecap="round" />
                    <line x1={p.x1 - ox} y1={p.y1 - oy} x2={p.x2 - ox} y2={p.y2 - oy} stroke={ARROW_WHITE} strokeWidth={2.5} strokeLinecap="round" markerEnd="url(#tb-head)" />
                  </g>
                );
              }
              return (
                <g key={a.id}>
                  {halo && <line {...p} {...halo} strokeLinecap="round" />}
                  <line {...p} stroke={ARROW_WHITE} strokeWidth={a.kind === "pass" ? 3.5 : 4} strokeLinecap="round"
                    strokeDasharray={a.kind === "run" ? "10 7" : undefined}
                    markerEnd={a.kind === "pass" ? "url(#tb-open)" : "url(#tb-head)"} onPointerDown={onDown} style={{ cursor: "pointer" }} />
                </g>
              );
            })}
            {draft && (drawKind === "zone"
              ? <rect data-skip x={px(Math.min(draft.from.x, draft.to.x))} y={py(Math.min(draft.from.y, draft.to.y))} width={Math.abs(draft.to.x - draft.from.x) * (VB_W - 2 * M)} height={Math.abs(draft.to.y - draft.from.y) * (pitchH - 2 * M)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.7)" strokeWidth={2.5} strokeDasharray="8 6" rx={6} />
              : drawKind === "dribble"
                ? <path data-skip d={wavyPath(draft.from.x * (VB_W - 2 * M) + M, draft.from.y * (pitchH - 2 * M) + M, draft.to.x * (VB_W - 2 * M) + M, draft.to.y * (pitchH - 2 * M) + M)} fill="none" stroke={ARROW_WHITE} strokeWidth={4} strokeLinecap="round" markerEnd="url(#tb-head)" />
                : <line data-skip x1={px(draft.from.x)} y1={py(draft.from.y)} x2={px(draft.to.x)} y2={py(draft.to.y)} stroke={ARROW_WHITE} strokeWidth={4} strokeLinecap="round" strokeDasharray={drawKind === "run" ? "10 7" : undefined} markerEnd={drawKind === "pass" ? "url(#tb-open)" : "url(#tb-head)"} />)}

            {/* tokens */}
            {tokens.map((t) => {
              const x = px(t.x), y = py(t.y);
              const selected = t.id === selId;
              const halo = selected ? <circle data-skip cx={x} cy={y} r={R + 6} fill="none" stroke="#38BDF8" strokeWidth={3} strokeDasharray="3 3" /> : null;
              if (t.kind === "ball") {
                return (
                  <g key={t.id} onPointerDown={(e) => onTokenDown(e, t)} style={{ cursor: "grab" }}>
                    <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                    {selected && <circle data-skip cx={x} cy={y} r={R + 4} fill="none" stroke="#38BDF8" strokeWidth={3} strokeDasharray="3 3" />}
                    <circle cx={x} cy={y} r={12} fill="#fff" stroke="#111" strokeWidth={2} />
                    <circle cx={x} cy={y} r={4.5} fill="#111" />
                  </g>
                );
              }
              if (t.kind === "cone") {
                return (
                  <g key={t.id} onPointerDown={(e) => onTokenDown(e, t)} style={{ cursor: "grab" }}>
                    <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                    {halo}
                    <polygon points={`${x},${y - 16} ${x - 13},${y + 12} ${x + 13},${y + 12}`} fill="#F97316" stroke="#7C2D12" strokeWidth={2} />
                  </g>
                );
              }
              if (t.kind === "goal") {
                return (
                  <g key={t.id} onPointerDown={(e) => onTokenDown(e, t)} style={{ cursor: "grab" }}>
                    <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                    {selected && <rect data-skip x={x - 48} y={y - 22} width={96} height={44} rx={4} fill="none" stroke="#38BDF8" strokeWidth={3} strokeDasharray="3 3" />}
                    <GoalMark x={x} y={y} />
                  </g>
                );
              }
              if (t.kind === "mannequin") {
                return (
                  <g key={t.id} onPointerDown={(e) => onTokenDown(e, t)} style={{ cursor: "grab" }}>
                    <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                    {halo}
                    <rect x={x - 9} y={y - 18} width={18} height={36} rx={8} fill="#94A3B8" stroke="#475569" strokeWidth={2} />
                    <rect x={x - 13} y={y + 16} width={26} height={5} rx={2.5} fill="#64748B" />
                  </g>
                );
              }
              return (
                <g key={t.id} onPointerDown={(e) => onTokenDown(e, t)} style={{ cursor: "grab" }}>
                  <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
                  {halo}
                  <circle cx={x} cy={y} r={R} fill={TEAM_COLORS[t.kind] || "#64748B"} stroke="rgba(0,0,0,0.4)" strokeWidth={2} />
                  {t.label ? <text x={x} y={y + R * 0.34} textAnchor="middle" fontSize={R * 0.85} fontWeight="700" fill="#fff" style={{ pointerEvents: "none" }}>{t.label}</text> : null}
                </g>
              );
            })}
            <LegendStrip y={pitchH} />
          </svg>
        </div>

        {/* selection bar */}
        {sel && (
          <div className="px-3 py-2 bg-slate-800 border-t border-white/10 flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Selected</span>
            {selToken && (selToken.kind === "focus" || selToken.kind === "opp" || selToken.kind === "gk") && (
              <input value={selToken.label || ""} onChange={(e) => setLabel(selToken.id, e.target.value)} maxLength={3} aria-label="Player number" className="w-16 bg-white/10 text-white text-xs font-bold text-center rounded-lg px-2 py-2 border border-white/15 outline-none" />
            )}
            {(selToken || selZone) && (
              <button onClick={duplicateSelected} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-white/10 text-white min-h-11"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
            )}
            <button onClick={removeSelected} className="ml-auto flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full bg-red-500/80 text-white min-h-11"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          </div>
        )}

        {/* toolbar — tap-to-place row, then move/draw row */}
        <div className="bg-slate-800 border-t border-white/10 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setMode("place"); setPlaceKind(null); }} aria-pressed={mode === "place"} title="Tap to place" className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 ${mode === "place" ? "text-white" : "text-white/60 bg-white/10"}`} style={mode === "place" ? { backgroundColor: TEAM_COLORS.focus } : {}}><Hand className="w-4 h-4" /> Place</button>
            {PLACE_BTNS.map(([kind, lbl, color]) => (
              <button key={kind} onClick={() => { setMode("place"); setPlaceKind(kind); }} aria-pressed={mode === "place" && placeKind === kind} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 ${mode === "place" && placeKind === kind ? "text-white ring-2 ring-sky-400" : "text-white bg-white/10"}`} style={mode === "place" && placeKind === kind ? { backgroundColor: TEAM_COLORS.focus } : {}}>
                {kind === "cone"
                  ? <span className="w-0 h-0" style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "9px solid #F97316" }} />
                  : kind === "ball"
                    ? <span className="w-3 h-3 rounded-full bg-white border border-black" />
                    : kind === "goal"
                      ? <span className="w-3.5 h-2 border-2 border-white rounded-sm" />
                      : kind === "mannequin"
                        ? <span className="w-2.5 h-4 rounded-full bg-slate-400" />
                        : <span className="w-3 h-3 rounded-full" style={{ background: color }} />}
                {lbl}
              </button>
            ))}
            <button onClick={clearBoard} className="ml-auto flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white/10 text-white min-h-11"><RotateCcw className="w-3.5 h-3.5" /> Clear</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-white/5 rounded-full p-1">
              <button onClick={() => { setMode("move"); setPlaceKind(null); }} aria-pressed={mode === "move"} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full min-h-9 ${mode === "move" ? "text-white" : "text-white/50"}`} style={mode === "move" ? { backgroundColor: TEAM_COLORS.focus } : {}}><MousePointer2 className="w-3.5 h-3.5" /> Move</button>
              <button onClick={() => { setMode("draw"); setPlaceKind(null); }} aria-pressed={mode === "draw"} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full min-h-9 ${mode === "draw" ? "text-white" : "text-white/50"}`} style={mode === "draw" ? { backgroundColor: TEAM_COLORS.focus } : {}}><Spline className="w-3.5 h-3.5" /> Draw</button>
            </div>
            {mode === "draw" && (
              <div className="flex items-center gap-1 flex-wrap">
                {DRAW_BTNS.map(([k, lbl]) => (
                  <button key={k} onClick={() => setDrawKind(k)} aria-pressed={drawKind === k} className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-2 rounded-full border min-h-9 ${drawKind === k ? "text-white border-sky-400 bg-sky-500/25" : "text-white/60 border-white/15 bg-white/5"}`}>
                    {k === "zone" && (lbl === "Zone" ? <SquareDashed className="w-3 h-3" /> : <CircleDashed className="w-3 h-3" />)}
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setSnap(!snap)} aria-pressed={snap} title="Snap markers to a grid" className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-full border min-h-9 ${snap ? "text-white border-sky-400 bg-sky-500/25" : "text-white/60 border-white/15 bg-white/5"}`}><Magnet className="w-3.5 h-3.5" /> Snap</button>
            <span className="text-[10px] text-white/40 font-medium ml-auto">
              {mode === "place" ? (placeKind ? `Tap the pitch to place a ${placeKind}` : "Pick a marker, then tap the pitch")
                : mode === "draw" ? (drawKind === "zone" ? "Drag to draw a zone" : `Drag to draw a ${drawKind}`)
                  : "Drag players, ball, cones & goals"}
            </span>
          </div>
          {/* printed legend (also drawn into the exported PNG) */}
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-white/5">
            {ARROW_LEGEND.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-white/60">
                <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
                  {a.id === "dribble"
                    ? <path d={wavyPath(1, 5, 25, 5, 2.5, 8)} fill="none" stroke={ARROW_WHITE} strokeWidth={1.8} />
                    : a.id === "shot"
                      ? <g><line x1="1" y1="3" x2="25" y2="3" stroke={ARROW_WHITE} strokeWidth={1.4} /><line x1="1" y1="7" x2="25" y2="7" stroke={ARROW_WHITE} strokeWidth={1.4} /></g>
                      : <line x1="1" y1="5" x2="25" y2="5" stroke={ARROW_WHITE} strokeWidth={2} strokeDasharray={a.id === "run" ? "4 3" : undefined} markerEnd={a.id === "pass" ? "url(#tb-open)" : undefined} />}
                </svg>
                {a.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/60 ml-auto">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: TEAM_COLORS.focus }} /> Focus
              <span className="w-2.5 h-2.5 rounded-full ml-2" style={{ background: TEAM_COLORS.opp }} /> Opp
              <span className="w-2.5 h-2.5 rounded-full ml-2" style={{ background: TEAM_COLORS.gk }} /> GK
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
