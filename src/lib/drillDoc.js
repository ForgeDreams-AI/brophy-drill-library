// ─── Shared drill document shape ───────────────────────────────────────────
// ONE library for the Brophy TeamHub app and the standalone Drill Library
// site: both apps read and write the `drillLibrary` collection in the
// brophy-soccer-app project. A drill made in either app shows up in both.
//
// Canonical drill doc (all fields optional except `name`):
//   name: string (required, non-empty — enforced by Firestore rules)
//   title?: string — display title; falls back to `name`
//   kind?: "drill" — anything else (e.g. legacy "point" coaching-point
//     items from the old `drills` collection) is NOT a drill and is
//     filtered out of every list
//   cat: string — one of the 17 DRILL_CATEGORIES; coaches can also add
//     their own from the drill form. Any other value still renders, and
//     once a drill uses it the category shows in the filter list.
//   tags?: string[]
//   dur?: number | string — minutes (the library writes a number, the
//     team app writes a string; both display fine)
//   players?: string
//   equipment?: string — comma-separated (team app); the structured copy
//     lives in setup.equipment
//   setup?: { grid?: string ("30x20 yd"), teams?: string,
//             lengthYd?: number | null, widthYd?: number | null,
//             cones?: number | null, balls?: number | null,
//             goals?: number | null, mannequins?: number | null,
//             equipment?: string[] }
//   howTo?: string — one step per line
//   objectives?: string[]
//   desc?: string
//   info?: string — coaching points; a "Source: ..." prefix is attribution
//   videoUrl?: string
//   photos?: string[] — image URLs (team app uploads)
//   diagram?: string | null — raster PNG of the board (team app upload)
//   diagramData?: object | null — structured board JSON, the editable diagram
//   diagramImage?: string | null — setup still from the Soccer Video Library;
//     WINS over diagramData and diagram when set (photo-first rule)
//   scenario?: string
//   cues?: string[]
//   createdAt?: timestamp, updatedAt?: timestamp
//   createdByUid?: string, createdByName?: string
//
// Keep this comment in sync with the copy in the TeamHub app
// (teamhub/src/lib/drillDoc.js). The old `drills` collection is dead for
// reads/writes after the unification; its real drills are copied here by
// work/migrate-drills-to-canonical.js (kind === "point" items are skipped).

import { DRILL_CATEGORIES } from "../data/categories";

export const DRILL_KIND = "drill";

// Tolerant read: fill in defaults so a doc written by either app renders
// in the other without crashing on a missing or mistyped field.
export function normalizeDrillDoc(d) {
  const doc = { ...(d || {}) };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === "string" ? v : "");
  const setup = doc.setup && typeof doc.setup === "object" ? doc.setup : {};
  return {
    ...doc,
    name: str(doc.name),
    title: str(doc.title),
    kind: str(doc.kind) || DRILL_KIND,
    cat: str(doc.cat) || DRILL_CATEGORIES[0],
    tags: arr(doc.tags),
    dur: doc.dur ?? "",
    players: str(doc.players),
    equipment: str(doc.equipment),
    setup: {
      ...setup,
      grid: str(setup.grid),
      teams: str(setup.teams),
      lengthYd: setup.lengthYd ?? null,
      widthYd: setup.widthYd ?? null,
      cones: setup.cones ?? null,
      balls: setup.balls ?? null,
      goals: setup.goals ?? null,
      mannequins: setup.mannequins ?? null,
      equipment: arr(setup.equipment),
    },
    howTo: str(doc.howTo),
    objectives: arr(doc.objectives),
    desc: str(doc.desc),
    info: str(doc.info),
    videoUrl: str(doc.videoUrl),
    photos: arr(doc.photos),
    diagram: doc.diagram || null,
    diagramData: doc.diagramData || null,
    diagramImage: doc.diagramImage || null,
    scenario: str(doc.scenario),
    cues: arr(doc.cues),
    createdByUid: str(doc.createdByUid),
    createdByName: str(doc.createdByName),
  };
}

const lines = (t) => (t || "").split("\n").map((s) => s.trim()).filter(Boolean);

// "30 × 20" (or "30x20", "30, 20") → [30, 20]. Anything else → [null, null].
export function parseGrid(text) {
  const m = String(text || "").match(/(\d+)\s*[×x,/ ]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

const numOrNull = (v) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || Number.isNaN(n) ? null : n;
};

// A drill doc → the quick-add form's state. Team-app-only fields (title,
// photos, scenario, cues, kind, setup teams/grid, raster diagram) ride
// along in state so editing in the library never wipes them — they just
// aren't all shown in the form.
export function drillDocToForm(d) {
  const doc = normalizeDrillDoc(d);
  const s = doc.setup;
  return {
    name: doc.name,
    title: doc.title,
    kind: doc.kind,
    cat: doc.cat,
    tags: doc.tags.join(", "),
    dur: doc.dur ?? "",
    players: doc.players,
    setupGrid: s.lengthYd && s.widthYd ? `${s.lengthYd} × ${s.widthYd}` : "",
    setupGridRaw: s.grid,
    setupTeams: s.teams,
    equipment: s.equipment.join(", "),
    howTo: doc.howTo,
    objectives: doc.objectives.join("\n"),
    desc: doc.desc,
    info: doc.info,
    videoUrl: doc.videoUrl,
    diagramData: doc.diagramData,
    diagramImage: doc.diagramImage,
    diagram: doc.diagram,
    photos: doc.photos,
    scenario: doc.scenario,
    cues: doc.cues.join("\n"),
    // Kept in state so editing an older drill never wipes its counts —
    // they just aren't shown in the form anymore.
    setupCones: s.cones ?? "",
    setupBalls: s.balls ?? "",
    setupGoals: s.goals ?? "",
    setupMannequins: s.mannequins ?? "",
  };
}

// The form's state → the Firestore payload for add/update. Everything the
// other app writes comes back unchanged, so a library edit never drops a
// team-app field (and vice versa).
export function formToDrillPayload(form) {
  const [gridL, gridW] = parseGrid(form.setupGrid);
  return {
    name: form.name.trim(),
    title: (form.title || "").trim(),
    kind: form.kind || DRILL_KIND,
    cat: (form.cat || "").trim() || DRILL_CATEGORIES[0],
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    dur: numOrNull(form.dur),
    players: form.players.trim(),
    equipment: (form.equipment || "").trim(),
    setup: {
      grid: gridL && gridW ? `${gridL}x${gridW} yd` : (form.setupGridRaw || ""),
      teams: (form.setupTeams || "").trim(),
      lengthYd: gridL,
      widthYd: gridW,
      cones: numOrNull(form.setupCones),
      balls: numOrNull(form.setupBalls),
      goals: numOrNull(form.setupGoals),
      mannequins: numOrNull(form.setupMannequins),
      equipment: form.equipment.split(",").map((t) => t.trim()).filter(Boolean),
    },
    diagramData: form.diagramData || null,
    diagramImage: form.diagramImage.trim() || null,
    diagram: form.diagram || null,
    photos: Array.isArray(form.photos) ? form.photos : [],
    howTo: form.howTo.trim(),
    objectives: lines(form.objectives),
    desc: form.desc.trim(),
    info: form.info.trim(),
    videoUrl: form.videoUrl.trim(),
    scenario: (form.scenario || "").trim(),
    cues: lines(form.cues),
  };
}
