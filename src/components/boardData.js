// Shared board data for the practice diagram board (Option C).
// Kept in its own module (not in TacticsBoard.jsx) so the board component file
// only exports components — and so the drill library can import the legend,
// presets and board-state helpers without pulling in the editor.
//
// Board state (v2, stored on the drill doc as `diagramData`):
//   { field, lengthYd, widthYd, tokens, arrows, zones }
//   token: { id, kind: 'focus'|'opp'|'gk'|'ball'|'cone'|'goal'|'mannequin'|'pole'|'ladder', x, y, label, rot? }
//     rot = rotation in degrees (equipment only: goal, mannequin, pole, ladder)
//   arrow: { id, kind: 'pass'|'run'|'dribble'|'shot'|'direction'|'freehand', from:{x,y}, to:{x,y}, bend?, color?, points? }
//     bend = optional quadratic control point {x,y} — a bent (curved) arrow;
//       absent = straight. points = freehand polyline [{x,y}…] (kind 'freehand').
//   zone:  { id, shape: 'rect'|'circle', x, y, w, h }   (x,y,w,h normalized 0..1)
//   animation?: { steps: [...] } — recorded movement, played back in the
//     studio and from the drill detail ("Play the drill"). A step moves ONE
//     token along ONE path, in list order (steps play one after another):
//       { id, tokenId, path, durMs, receiverId? }
//       path = { kind: 'arrow', arrowId } — follow an existing arrow
//              (its centreline, bend included), or
//              { kind: 'freehand', points: [{x,y}…] } — a drawn track
//       durMs = how long the step takes (recorded from the path length)
//       receiverId = a token near the path's end (a pass target); the moving
//              token ends ON that token's position at the end of the step.
//     Absent = a static diagram (no Play button, nothing changes).
//     Steps whose token/arrow no longer exists are dropped on load.
//
// Arrow legend (fixed everywhere — printed on every diagram export):
//   pass = solid line, OPEN arrowhead · run = dashed · dribble = wavy
//   shot = double line · direction = plain solid
// Team colours: focus = blue, opponents = red, goalkeeper = yellow.

export const ARROW_COLORS = ["#FFFFFF", "#FACC15", "#38BDF8"]; // white, yellow, sky
// Approximate half-size of each token kind, in board units — used for hit
// areas and for smart-guide edge snapping.
export const TOKEN_HALF = { focus: 19, opp: 19, gk: 19, ball: 12, cone: 13, goal: 42, mannequin: 13, pole: 6, ladder: 20 };

// Sample a quadratic Bézier (p1, control, p2) at N points.
const quadSamples = (p1, c, p2, n = 16) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({ x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y });
  }
  return pts;
};
const polylineD = (pts) => pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
// Apply a tapered sine wiggle along a sampled polyline (the dribble squiggle).
const wavyAlong = (pts, amp = 7, wl = 20) => {
  const len = pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0) || 1;
  return pts.map((p, i) => {
    const t = i / (pts.length - 1);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const off = Math.sin(t * (len / wl) * Math.PI * 2) * amp * Math.sin(t * Math.PI);
    return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
  });
};
// Offset a sampled polyline sideways by `off` board units (shot double line).
const offsetAlong = (pts, off) => pts.map((p, i) => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
});

// Geometry for one arrow in pixel coords. px(x)/py(y) map normalized 0..1
// board coords to SVG pixels. Returns { d, d2, mid, pts }:
//   d = main path, d2 = second line for shot (else null),
//   mid = pixel point of the number badge (curve midpoint),
//   pts = sampled centreline (for the invisible hit path).
export function arrowGeom(a, px, py) {
  if (a.kind === "freehand" && Array.isArray(a.points) && a.points.length > 1) {
    const pts = a.points.map((p) => ({ x: px(p.x), y: py(p.y) }));
    return { d: polylineD(pts), d2: null, mid: pts[Math.floor(pts.length / 2)], pts };
  }
  const p1 = { x: px(a.from.x), y: py(a.from.y) };
  const p2 = { x: px(a.to.x), y: py(a.to.y) };
  const c = a.bend ? { x: px(a.bend.x), y: py(a.bend.y) } : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  let pts = quadSamples(p1, c, p2);
  const mid = pts[Math.floor(pts.length / 2)];
  if (a.kind === "dribble") pts = wavyAlong(pts);
  if (a.kind === "shot") {
    return { d: polylineD(offsetAlong(pts, 4)), d2: polylineD(offsetAlong(pts, -4)), mid, pts };
  }
  return { d: polylineD(pts), d2: null, mid, pts };
}

// Pitch-line snap targets in normalized board coords (penalty-box edges,
// six-yard box, halfway line, penalty spots, goal lines). The editor's
// smart guides snap live to these while dragging.
export function pitchSnapLines(state) {
  const { preset, wYd, dYd } = boardDims(state);
  const xs = [], ys = [];
  if (preset.orient === "portrait") {
    const mid = wYd / 2;
    xs.push(0, (mid - 22) / wYd, 0.5, (mid + 22) / wYd, (mid - 10) / wYd, (mid + 10) / wYd, 1);
    ys.push(0, 6 / dYd, 12 / dYd, 18 / dYd, 1);
  } else if (preset.id === "full") {
    xs.push(0, 6 / wYd, 12 / wYd, 18 / wYd, 0.5, 1 - 18 / wYd, 1 - 12 / wYd, 1 - 6 / wYd, 1);
    ys.push(0, (dYd - 44) / 2 / dYd, (dYd - 20) / 2 / dYd, 0.5, (dYd + 20) / 2 / dYd, (dYd + 44) / 2 / dYd, 1);
  } else {
    xs.push(0, 0.5, 1);
    ys.push(0, 0.5, 1);
  }
  return { xs: xs.filter((v) => v >= 0 && v <= 1), ys: ys.filter((v) => v >= 0 && v <= 1) };
}

export const VB_W = 680;      // board width in viewBox units
export const LEG_H = 76;      // legend strip height (drawn in the SVG, exports with it)
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Pitch presets — real yard dimensions, correct proportions ──────────────
// Pro field is 115 × 75 yd (FIFA 105 m × 68 m). Every preset is a true slice
// of it: half = half the length, final third = a third of the length, both
// at the FULL 75 yd width, so the penalty box (44 × 18 yd) always sits in
// its real proportion — 15.5 yd of field on each side — never stretched.
export const BOARD_PRESETS = [
  { id: "full", label: "Full pitch", lengthYd: 115, widthYd: 75, orient: "landscape", note: "115 × 75 yd" },
  { id: "half", label: "Half pitch", lengthYd: 57.5, widthYd: 75, orient: "portrait", note: "75 × 57.5 yd" },
  { id: "third", label: "Final third", lengthYd: 38, widthYd: 75, orient: "portrait", note: "75 × 38 yd" },
  { id: "grid", label: "Grid / zone", lengthYd: 30, widthYd: 20, orient: "landscape", note: "custom yd" },
];

// Validate a recorded animation against the board it belongs to: drop
// steps whose token is gone, whose arrow is gone, or whose track is too
// short to follow. Unknown fields ride along untouched (forward-compat).
export function normalizeAnimation(raw, tokens, arrows) {
  const tokenIds = new Set((tokens || []).map((t) => t.id));
  const arrowIds = new Set((arrows || []).map((a) => a.id));
  const stepsIn = Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = [];
  stepsIn.forEach((s, i) => {
    if (!s || !tokenIds.has(s.tokenId)) return;
    const durMs = Math.max(300, Math.min(10000, Number(s.durMs) || 1200));
    const receiverId = tokenIds.has(s.receiverId) && s.receiverId !== s.tokenId ? s.receiverId : undefined;
    if (s.path?.kind === "arrow") {
      if (!arrowIds.has(s.path.arrowId)) return;
      steps.push({ id: typeof s.id === "string" && s.id ? s.id : `step-${i}`, tokenId: s.tokenId, path: { kind: "arrow", arrowId: s.path.arrowId }, durMs, ...(receiverId ? { receiverId } : {}) });
    } else if (s.path?.kind === "freehand" && Array.isArray(s.path.points)) {
      const points = s.path.points
        .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
      if (points.length < 2) return;
      steps.push({ id: typeof s.id === "string" && s.id ? s.id : `step-${i}`, tokenId: s.tokenId, path: { kind: "freehand", points }, durMs, ...(receiverId ? { receiverId } : {}) });
    }
  });
  return { steps };
}

// Back-compat: map the old board state (field/tokens/arrows only) to v2.
// Firestore rejects `undefined` anywhere in a doc, and the editor used to
// write `bend: undefined` onto straightened arrows — an own property with
// an undefined value that survives every spread. Drop undefined-valued keys
// here so a loaded board can never carry one back into a save.
const dropUndefined = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined) out[k] = v;
  return out;
};

export function normalizeBoardState(initial) {
  const raw = initial || {};
  const fieldMap = { soccer: "full", "soccer-half": "half", "soccer-third": "third", "soccer-box": "third", box: "third", blank: "grid", basketball: "grid", football: "grid" };
  const field = BOARD_PRESETS.some((p) => p.id === raw.field) ? raw.field : (fieldMap[raw.field] || "half");
  const preset = BOARD_PRESETS.find((p) => p.id === field);
  const tokenMap = { home: "focus", away: "opp", neutral: "gk" };
  const arrowMap = { run: "run", pass: "pass", dribble: "dribble", line: "direction" };
  const tokens = (raw.tokens || []).map((t) => dropUndefined({ ...t, kind: tokenMap[t.kind] || t.kind || "focus" }));
  const arrows = (raw.arrows || []).map((a) => dropUndefined({ ...a, kind: arrowMap[a.kind] || a.kind || "run" }));
  const zones = (raw.zones || []).filter((z) => z && (z.shape === "rect" || z.shape === "circle"));
  return {
    field,
    lengthYd: Number(raw.lengthYd) > 0 ? Number(raw.lengthYd) : preset.lengthYd,
    widthYd: Number(raw.widthYd) > 0 ? Number(raw.widthYd) : preset.widthYd,
    tokens,
    arrows,
    zones,
    animation: normalizeAnimation(raw.animation, tokens, arrows),
  };
}

// Pitch height for a preset (viewBox units) from its yard aspect.
export function boardDims(state) {
  const s = normalizeBoardState(state);
  const preset = BOARD_PRESETS.find((p) => p.id === s.field) || BOARD_PRESETS[1];
  const wYd = preset.orient === "portrait" ? s.widthYd : s.lengthYd;
  const dYd = preset.orient === "portrait" ? s.lengthYd : s.widthYd;
  // Min height 320 (not 380) so the final third's true height (~345) is not
  // stretched taller — the pitch must keep its real yard aspect.
  const ph = clamp(Math.round((VB_W * dYd) / wYd), 320, 920);
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
