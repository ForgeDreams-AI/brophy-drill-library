// Shared board data for the practice diagram board (Option C).
// Kept in its own module (not in TacticsBoard.jsx) so the board component file
// only exports components — and so the drill library can import the legend,
// presets and board-state helpers without pulling in the editor.
//
// Board state (v2, stored on the drill doc as `diagramData`):
//   { field, lengthYd, widthYd, tokens, arrows, zones }
//   token: { id, kind: 'focus'|'opp'|'gk'|'ball'|'cone'|'goal'|'mannequin', x, y, label }
//   arrow: { id, kind: 'pass'|'run'|'dribble'|'shot'|'direction', from:{x,y}, to:{x,y} }
//   zone:  { id, shape: 'rect'|'circle', x, y, w, h }   (x,y,w,h normalized 0..1)
//
// Arrow legend (fixed everywhere — printed on every diagram export):
//   pass = solid line, OPEN arrowhead · run = dashed · dribble = wavy
//   shot = double line · direction = plain solid
// Team colours: focus = blue, opponents = red, goalkeeper = yellow.

export const VB_W = 680;      // board width in viewBox units
export const LEG_H = 76;      // legend strip height (drawn in the SVG, exports with it)
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Pitch presets — real yard dimensions, correct proportions ──────────────
export const BOARD_PRESETS = [
  { id: "full", label: "Full pitch", lengthYd: 115, widthYd: 75, orient: "landscape", note: "115 × 75 yd" },
  { id: "half", label: "Half pitch", lengthYd: 58, widthYd: 75, orient: "portrait", note: "75 × 58 yd" },
  { id: "box", label: "Penalty box", lengthYd: 36, widthYd: 44, orient: "portrait", note: "44 × 36 yd" },
  { id: "grid", label: "Grid / zone", lengthYd: 30, widthYd: 20, orient: "landscape", note: "custom yd" },
];

// Back-compat: map the old board state (field/tokens/arrows only) to v2.
export function normalizeBoardState(initial) {
  const raw = initial || {};
  const fieldMap = { soccer: "full", "soccer-half": "half", "soccer-third": "half", "soccer-box": "box", blank: "grid", basketball: "grid", football: "grid" };
  const field = BOARD_PRESETS.some((p) => p.id === raw.field) ? raw.field : (fieldMap[raw.field] || "half");
  const preset = BOARD_PRESETS.find((p) => p.id === field);
  const tokenMap = { home: "focus", away: "opp", neutral: "gk" };
  const arrowMap = { run: "run", pass: "pass", dribble: "dribble", line: "direction" };
  return {
    field,
    lengthYd: Number(raw.lengthYd) > 0 ? Number(raw.lengthYd) : preset.lengthYd,
    widthYd: Number(raw.widthYd) > 0 ? Number(raw.widthYd) : preset.widthYd,
    tokens: (raw.tokens || []).map((t) => ({ ...t, kind: tokenMap[t.kind] || t.kind || "focus" })),
    arrows: (raw.arrows || []).map((a) => ({ ...a, kind: arrowMap[a.kind] || a.kind || "run" })),
    zones: (raw.zones || []).filter((z) => z && (z.shape === "rect" || z.shape === "circle")),
  };
}

// Pitch height for a preset (viewBox units) from its yard aspect.
export function boardDims(state) {
  const s = normalizeBoardState(state);
  const preset = BOARD_PRESETS.find((p) => p.id === s.field) || BOARD_PRESETS[1];
  const wYd = preset.orient === "portrait" ? s.widthYd : s.lengthYd;
  const dYd = preset.orient === "portrait" ? s.lengthYd : s.widthYd;
  const ph = clamp(Math.round((VB_W * dYd) / wYd), 380, 920);
  return { preset, wYd, dYd, pitchH: ph, vbH: ph + LEG_H };
}

export const TEAM_COLORS = { focus: "#2563EB", opp: "#DC2626", gk: "#EAB308" };
export const ARROW_LEGEND = [
  { id: "pass", label: "Pass", desc: "Solid, open head" },
  { id: "run", label: "Run", desc: "Dashed" },
  { id: "dribble", label: "Dribble", desc: "Wavy" },
  { id: "shot", label: "Shot", desc: "Double line" },
  { id: "direction", label: "Direction", desc: "Plain solid" },
];

// A hand-drawn "dribble" squiggle from (x1,y1)→(x2,y2): a sine wave along the
// line, tapered to 0 at both ends so it starts/ends cleanly.
export const wavyPath = (x1, y1, x2, y2, amp = 7, wl = 20) => {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const steps = Math.max(8, Math.round(len / 6));
  let d = `M ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * (len / wl) * Math.PI * 2) * amp * Math.sin(t * Math.PI);
    const x = x1 + ux * len * t + px * off, y = y1 + uy * len * t + py * off;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
};
