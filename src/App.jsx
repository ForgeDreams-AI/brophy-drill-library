// ─── Brophy Drill Library ──────────────────────────────────────────────────
// Standalone reference library for Brophy College Prep soccer. Public to
// browse (no sign-in needed); only coaches (role admin / orgAdmin in the
// Brophy Firebase project) can add, edit or delete drills.
//
// ONE shared library: drills live in the `drillLibrary` collection, which
// the TeamHub app (brophy-soccer-app) reads and writes too — a drill made
// in either app shows up in both. The shared document shape is defined in
// src/lib/drillDoc.js (normalizeDrillDoc / drillDocToForm /
// formToDrillPayload); the review queue below still approves into the same
// collection. The old `drills` collection is dead — its real drills were
// copied here by work/migrate-drills-to-canonical.js.
// Review queue: coaches send videos from the Soccer Video Library with
// ?add=1… — they land in `drillSuggestions` (limbo) until a coach approves
// (quick-add form) or dismisses them. Duplicates are caught twice: at
// suggest time and again in the queue, against the drills already live.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, LogIn, LogOut, X, Clock, Users, LayoutGrid,
  ChevronLeft, Pencil, Copy, Trash2, Play, Link2, BookOpen,
  Layers, Check, AlertTriangle, WifiOff, Inbox, Printer,
} from "lucide-react";
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, getDoc, getDocs, where, serverTimestamp,
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import { auth, db } from "./firebase";
import { DRILL_CATEGORIES } from "./data/categories";
import { normalizeDrillDoc, drillDocToForm, formToDrillPayload, DRILL_KIND } from "./lib/drillDoc";
import TacticsBoard, { BoardSvg, BoardPlayer } from "./components/TacticsBoard";
import DrillPrintSheet from "./components/DrillPrintSheet";
import { ARROW_LEGEND, wavyPath } from "./components/boardData";

// Classic Brophy (Option A, §11) — same palette as the main TeamHub app.
// Primary red #980000 sampled from brophyprep.org's header; accent #A6192E is
// the site's own --brophy-red variable. RED_LIGHT is a pale red tint DERIVED
// from #980000 (not from the site), for eyebrow text on the red header.
const RED = "#980000";
const ACCENT = "#A6192E";
const RED_LIGHT = "#F5C6C6";

// ── helpers ────────────────────────────────────────────────────────────────
const lines = (t) => (t || "").split("\n").map((s) => s.trim()).filter(Boolean);

// YouTube watch / shorts / youtu.be → embed URL. Anything else: null.
function youTubeEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return `https://www.youtube.com/embed/${u.searchParams.get("v") || ""}`;
      if (u.pathname.startsWith("/shorts/")) return `https://www.youtube.com/embed/${u.pathname.split("/")[2]}`;
      if (u.pathname.startsWith("/embed/")) return url.trim();
    }
  } catch { /* not a URL — treat as a plain link */ }
  return null;
}

// ── the fixed 5-arrow legend, as chips (same legend as the board) ──────────
function LegendChips() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {ARROW_LEGEND.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
            {a.id === "dribble"
              ? <path d={wavyPath(1, 5, 25, 5, 2.5, 8)} fill="none" stroke={ACCENT} strokeWidth={1.8} />
              : a.id === "shot"
                ? <g><line x1="1" y1="3" x2="25" y2="3" stroke={ACCENT} strokeWidth={1.4} /><line x1="1" y1="7" x2="25" y2="7" stroke={ACCENT} strokeWidth={1.4} /></g>
                : <line x1="1" y1="5" x2="25" y2="5" stroke={ACCENT} strokeWidth={2} strokeDasharray={a.id === "run" ? "4 3" : undefined} />}
          </svg>
          {a.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 ml-auto">
        <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" /> Focus
        <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] ml-2" /> Opp
        <span className="w-2.5 h-2.5 rounded-full bg-[#EAB308] ml-2" /> GK
      </span>
    </div>
  );
}

// ── drill card (library grid) ──────────────────────────────────────────────
export function DrillCard({ drill, onOpen }) {
  const s = drill.setup || {};
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      onClick={onOpen}
      className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md hover:border-slate-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-[#A6192E]"
    >
      <div className="aspect-[4/3] bg-white border-b border-slate-100 overflow-hidden flex items-center justify-center">
        {drill.diagramImage && imgOk
          ? <img src={drill.diagramImage} alt="" className="w-full h-full object-cover" onError={() => setImgOk(false)} />
          : drill.diagramData
          ? <BoardSvg state={drill.diagramData} className="w-full h-full" />
          : drill.diagram
          ? <img src={drill.diagram} alt="" className="w-full h-full object-cover" loading="lazy" />
          : (
            <div className="flex flex-col items-center gap-2 text-slate-300 px-4">
              <LayoutGrid className="w-10 h-10" />
              <span className="text-xs font-semibold text-slate-400">No diagram yet</span>
            </div>
          )}
      </div>
      <div className="p-4">
        <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ backgroundColor: RED }}>
          {drill.cat}
        </span>
        <h3 className="mt-2 text-base font-bold leading-snug" style={{ color: RED }}>{drill.title || drill.name}</h3>
        {drill.desc ? <p className="mt-1 text-sm text-slate-500 line-clamp-2">{drill.desc}</p> : null}
        <div className="mt-3 flex items-center gap-3 text-xs font-semibold text-slate-500 flex-wrap">
          {s.lengthYd && s.widthYd ? <span>{s.lengthYd} × {s.widthYd} yd</span> : null}
          {drill.dur ? <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{drill.dur} min</span> : null}
          {drill.players ? <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{drill.players}</span> : null}
          {drill.videoUrl ? <span className="flex items-center gap-1"><Play className="w-3.5 h-3.5" />Video</span> : null}
          {drill.diagramData?.animation?.steps?.length ? <span className="flex items-center gap-1 text-sky-600"><Play className="w-3.5 h-3.5 fill-sky-600" />Animated</span> : null}
        </div>
      </div>
    </button>
  );
}

// ── drill detail ───────────────────────────────────────────────────────────
// canEdit = coaches + drill builders (see canBuild in App). The Print button
// is for everyone — printing is read-only.
export function DrillDetail({ drill, canEdit, onBack, onEdit, onDuplicate, onDelete, onPrint, onPlay }) {
  const s = drill.setup || {};
  const embed = youTubeEmbed(drill.videoUrl);
  const hasAnimation = Boolean(drill.diagramData?.animation?.steps?.length);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const setupItems = [
    s.lengthYd && s.widthYd ? { k: "Grid", v: `${s.lengthYd} × ${s.widthYd} yd` } : null,
    s.cones ? { k: "Cones", v: String(s.cones) } : null,
    s.balls ? { k: "Balls", v: String(s.balls) } : null,
    s.goals ? { k: "Goals", v: String(s.goals) } : null,
    s.mannequins ? { k: "Mannequins", v: String(s.mannequins) } : null,
    drill.players ? { k: "Players", v: String(drill.players) } : null,
    drill.dur ? { k: "Duration", v: `${drill.dur} min` } : null,
  ].filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <button onClick={onBack} className="mt-4 flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900 min-h-11">
        <ChevronLeft className="w-4 h-4" /> All drills
      </button>

      <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ backgroundColor: RED }}>
            {drill.cat}
          </span>
          <h1 className="mt-2 text-2xl sm:text-3xl font-black leading-tight" style={{ color: RED }}>{drill.title || drill.name}</h1>
          {drill.desc ? <p className="mt-2 text-slate-600 leading-relaxed">{drill.desc}</p> : null}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {hasAnimation && (
            <button onClick={onPlay} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>
              <Play className="w-3.5 h-3.5 fill-white" /> Play animation
            </button>
          )}
          <button onClick={onPrint} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white border border-slate-200 text-slate-700 min-h-11">
            <Printer className="w-3.5 h-3.5" /> Print / Save PDF
          </button>
          {canEdit && (
            <>
              <button onClick={onEdit} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white border border-slate-200 text-slate-700 min-h-11">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={onDuplicate} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white border border-slate-200 text-slate-700 min-h-11">
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </button>
              <button
                onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 ${confirmDelete ? "bg-red-600 text-white" : "bg-white border border-red-200 text-red-600"}`}
              >
                <Trash2 className="w-3.5 h-3.5" /> {confirmDelete ? "Confirm delete" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* diagram — photo from the video wins over a hand-drawn one, then
          the raster PNG the team app exports, then nothing */}
      {drill.diagramImage && imgOk ? (
        <div className="mt-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <img src={drill.diagramImage} alt="Diagram" className="w-full" onError={() => setImgOk(false)} />
        </div>
      ) : drill.diagramData ? (
        <div className="mt-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <BoardSvg state={drill.diagramData} showLegend className="w-full" />
          <div className="px-4 py-3 border-t border-slate-100"><LegendChips /></div>
        </div>
      ) : drill.diagram ? (
        <div className="mt-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <img src={drill.diagram} alt="Diagram" className="w-full" loading="lazy" />
        </div>
      ) : (
        <div className="mt-5 bg-white rounded-2xl border border-dashed border-slate-300 py-10 flex flex-col items-center gap-2 text-slate-400">
          <LayoutGrid className="w-8 h-8" />
          <span className="text-sm font-semibold">No diagram for this drill yet</span>
        </div>
      )}

      {/* photos (team app uploads) */}
      {drill.photos && drill.photos.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Photos</h2>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {drill.photos.map((src, i) => (
              <img key={i} src={src} alt="" className="w-32 h-32 rounded-xl object-cover border border-slate-200 flex-shrink-0" loading="lazy" />
            ))}
          </div>
        </section>
      )}

      {/* setup */}
      {setupItems.length > 0 || (s.equipment && s.equipment.length > 0) ? (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Setup</h2>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {setupItems.map((it) => (
              <div key={it.k} className="bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{it.k}</div>
                <div className="text-sm font-bold text-slate-800">{it.v}</div>
              </div>
            ))}
          </div>
          {s.equipment && s.equipment.length > 0 && (
            <p className="mt-2 text-sm text-slate-600"><span className="font-bold text-slate-700">Equipment: </span>{s.equipment.join(", ")}</p>
          )}
        </section>
      ) : null}

      {/* how to */}
      {lines(drill.howTo).length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">How to run it</h2>
          <ol className="mt-2 space-y-2">
            {lines(drill.howTo).map((step, i) => (
              <li key={i} className="flex gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-black flex items-center justify-center" style={{ backgroundColor: RED }}>{i + 1}</span>
                <span className="text-sm text-slate-700 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* objectives */}
      {drill.objectives && drill.objectives.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Look for</h2>
          <ul className="mt-2 space-y-1.5">
            {drill.objectives.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />{o}</li>
            ))}
          </ul>
        </section>
      )}

      {/* scenario + cues (team app fields) */}
      {drill.scenario ? (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Scenario</h2>
          <p className="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-white rounded-xl border border-slate-200 px-4 py-3">{drill.scenario}</p>
        </section>
      ) : null}
      {drill.cues && drill.cues.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Cues</h2>
          <ul className="mt-2 space-y-1.5">
            {drill.cues.map((c, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />{c}</li>
            ))}
          </ul>
        </section>
      )}

      {/* coaching points */}
      {drill.info ? (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Coaching points</h2>
          <p className="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-white rounded-xl border border-slate-200 px-4 py-3">{drill.info}</p>
        </section>
      ) : null}

      {/* video */}
      {drill.videoUrl ? (
        <section className="mt-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Video</h2>
          {embed ? (
            <div className="mt-2 rounded-2xl overflow-hidden border border-slate-200 bg-black aspect-video">
              <iframe src={embed} title="Drill video" className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          ) : (
            <a href={drill.videoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-bold px-4 py-3 rounded-full bg-white border border-slate-200 text-slate-700 min-h-11">
              <Link2 className="w-4 h-4" /> Watch video
            </a>
          )}
        </section>
      ) : null}

      <p className="mt-8 text-xs text-slate-400">
        {drill.createdByName ? `Added by ${drill.createdByName}` : ""}{drill.tags && drill.tags.length > 0 ? ` · ${drill.tags.join(", ")}` : ""}
      </p>
    </div>
  );
}

// ── incoming drill from the Soccer Video Library ───────────────────────────
// The library links here as ?add=1&name=…&cat=…&videoUrl=…&coach=…&desc=…&diagram=…
// so a coach can turn a saved video into a drill without retyping it.
// cat must be one of the 17 drill categories; anything else (e.g. the video
// library's "Technical" / "Unsorted") falls back to the form default and the
// coach picks the category. diagram is the video's setup still — it becomes
// the drill's diagram photo, so nobody has to hand-draw the diagram.
function parseIncoming() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("add") !== "1") return null;
    const name = (q.get("name") || "").trim();
    const videoUrl = (q.get("videoUrl") || "").trim();
    if (!name || !videoUrl) return null;
    const cat = (q.get("cat") || "").trim();
    const coach = (q.get("coach") || "").trim();
    const desc = (q.get("desc") || "").trim();
    const diagram = (q.get("diagram") || "").trim();
    const diagramImage = diagram.startsWith("https://forgedreams-ai.github.io/soccer-video-library/thumbs/") && diagram.endsWith(".jpg") ? diagram : "";
    return {
      name,
      cat: DRILL_CATEGORIES.includes(cat) ? cat : "",
      videoUrl,
      desc,
      diagramImage,
      info: coach ? `Source: @${coach} (Soccer Video Library)` : "Source: Soccer Video Library",
      tags: ["video-library"],
    };
  } catch {
    return null;
  }
}

function clearIncomingParams() {
  try {
    const u = new URL(window.location.href);
    ["add", "name", "cat", "videoUrl", "coach", "desc", "diagram"].forEach((k) => u.searchParams.delete(k));
    window.history.replaceState({}, "", u.pathname + u.search);
  } catch {}
}

// ── coach drill form (add / edit / duplicate) ──────────────────────────────
// Blank form = an empty doc run through the shared mapping, so its shape
// can never drift from drillDocToForm.
const BLANK_FORM = drillDocToForm(null);

export function DrillForm({ initial, onCancel, onSaved, user }) {
  const [form, setForm] = useState(() => (initial ? drillDocToForm(initial) : BLANK_FORM));
  const [boardOpen, setBoardOpen] = useState(false); // diagram is optional — one tap away, never in the way
  const [newCat, setNewCat] = useState(false); // coach is typing a brand-new category
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(initial && initial.id);

  const save = async () => {
    if (!form.name.trim()) { setError("Give the drill a name."); return; }
    setSaving(true);
    setError("");
    const payload = {
      ...formToDrillPayload(form),
      updatedAt: serverTimestamp(),
    };
    try {
      if (isEdit) {
        await updateDoc(doc(db, "drillLibrary", initial.id), payload);
        onSaved(initial.id);
      } else {
        const ref = await addDoc(collection(db, "drillLibrary"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByUid: user.uid,
          createdByName: user.displayName || user.email || "Coach",
        });
        onSaved(ref.id);
      }
    } catch (e) {
      setError(e?.message || "Could not save the drill. Check your connection and try again.");
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#A6192E] focus:border-[#A6192E]";
  const labelCls = "block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1";

  return (
    <div className="max-w-2xl mx-auto px-4 pb-16">
      <button onClick={onCancel} className="mt-4 flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900 min-h-11">
        <ChevronLeft className="w-4 h-4" /> Cancel
      </button>
      <h1 className="mt-2 text-2xl font-black" style={{ color: RED }}>{isEdit ? "Edit drill" : "Add a drill"}</h1>
      <p className="mt-1 text-sm text-slate-500">Name it, say how to run it, done. A diagram is optional — add one only if it helps.</p>

      <div className="mt-5 space-y-4 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
        <div>
          <label className={labelCls} htmlFor="f-name">Drill name *</label>
          <input id="f-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Third-man break-out" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-video">Video — the clip this drill came from</label>
          <input id="f-video" value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=… or an Instagram link" className={inputCls} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls} htmlFor="f-cat">Category</label>
            {newCat ? (
              <div className="flex gap-1">
                <input autoFocus value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} placeholder="New category" className={`${inputCls} flex-1 min-w-0`} />
                <button type="button" onClick={() => { setNewCat(false); setForm({ ...form, cat: DRILL_CATEGORIES[0] }); }} className="px-2 rounded-xl bg-slate-100 text-slate-500" title="Back to list"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <select id="f-cat" value={form.cat} onChange={(e) => { if (e.target.value === "__new__") { setNewCat(true); setForm({ ...form, cat: "" }); } else setForm({ ...form, cat: e.target.value }); }} className={inputCls}>
                {DRILL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">＋ Add new category…</option>
              </select>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="f-players">Players</label>
            <input id="f-players" value={form.players} onChange={(e) => setForm({ ...form, players: e.target.value })} placeholder="e.g. 8 + 2 GKs" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-dur">Minutes</label>
            <input id="f-dur" type="number" min={1} value={form.dur} onChange={(e) => setForm({ ...form, dur: e.target.value })} placeholder="12" className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="f-grid">Grid size (yd)</label>
            <input id="f-grid" value={form.setupGrid} onChange={(e) => setForm({ ...form, setupGrid: e.target.value })} placeholder="30 × 20" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-equip">Equipment</label>
            <input id="f-equip" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="bibs, cones, balls" className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="f-howto">How to run it — one step per line</label>
          <textarea id="f-howto" value={form.howTo} onChange={(e) => setForm({ ...form, howTo: e.target.value })} rows={3} placeholder={"Set the grid\nSplit into two teams\nPlay 3 minutes, then rotate"} className={inputCls} />
        </div>

        {/* diagram — optional, one tap away. A photo from the video wins
            over a hand-drawn diagram; drawing one replaces the photo. */}
        <div>
          <span className={labelCls}>Diagram (optional)</span>
          {form.diagramImage ? (
            <div className="relative">
              <img src={form.diagramImage} alt="Diagram photo from the video" className="w-full rounded-xl border border-slate-200" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <button type="button" onClick={() => setForm({ ...form, diagramImage: "" })} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 border border-slate-200 flex items-center justify-center shadow" aria-label="Remove diagram photo">
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          ) : form.diagramData ? (
            <div className="relative">
              <BoardSvg state={form.diagramData} showLegend className="w-full rounded-xl border border-slate-200" />
              <button type="button" onClick={() => setForm({ ...form, diagramData: null })} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 border border-slate-200 flex items-center justify-center shadow" aria-label="Remove diagram">
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          ) : null}
          {form.diagramImage ? <p className="mt-1 text-xs font-semibold text-slate-500">Diagram photo from the video — no drawing needed.</p> : null}
          <button type="button" onClick={() => setBoardOpen(true)} className="mt-2 w-full py-3 rounded-full text-sm font-bold bg-slate-100 text-slate-700 flex items-center justify-center gap-2 min-h-12">
            <Layers className="w-4 h-4" /> {form.diagramImage ? "Replace with a hand-drawn diagram" : form.diagramData ? "Edit diagram" : "Add a diagram"}
          </button>
        </div>

        <details className="rounded-xl border border-slate-200 px-3 py-2.5">
          <summary className="text-sm font-bold text-slate-600 cursor-pointer">More details (optional)</summary>
          <div className="mt-3 space-y-4">
            <div>
              <label className={labelCls} htmlFor="f-tags">Tags (comma separated)</label>
              <input id="f-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="rondo, 1v1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-desc">Description</label>
              <textarea id="f-desc" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} rows={2} placeholder="One or two lines on what the drill is for" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-obj">Look for — one goal per line</label>
              <textarea id="f-obj" value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} rows={3} placeholder={"Third-man runs\nQuick combination play"} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="f-info">Coaching points</label>
              <textarea id="f-info" value={form.info} onChange={(e) => setForm({ ...form, info: e.target.value })} rows={3} placeholder="What to say, what to correct, when to stop and coach" className={inputCls} />
            </div>
          </div>
        </details>

        {error ? <p className="flex items-start gap-2 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-3 rounded-full text-sm font-bold bg-slate-100 text-slate-700 min-h-12">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-full text-sm font-bold text-white min-h-12 disabled:opacity-50" style={{ backgroundColor: RED }}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add drill"}
          </button>
        </div>
      </div>

      {boardOpen && (
        <TacticsBoard
          initial={form.diagramData}
          title={form.name || "Diagram"}
          onSave={(_blob, state) => {
            setForm((p) => ({
              ...p,
              diagramData: state,
              diagramImage: "",
              setupGrid: state?.lengthYd && state?.widthYd ? `${state.lengthYd} × ${state.widthYd}` : p.setupGrid,
            }));
            setBoardOpen(false);
          }}
          onClose={() => setBoardOpen(false)}
        />
      )}
    </div>
  );
}

// ── coach sign-in ──────────────────────────────────────────────────────────
function SignInModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const google = async () => {
    setBusy(true); setError("");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); onClose(); }
    catch (e) { setError(e?.message || "Google sign-in failed."); setBusy(false); }
  };
  const emailSignIn = async () => {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError("");
    try { await signInWithEmailAndPassword(auth, email.trim(), password); onClose(); }
    catch { setError("Could not sign in — check your email and password."); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black" style={{ color: RED }}>Coach sign in</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4 text-slate-600" /></button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Sign in with your Brophy account. Only coaches and drill builders can add drills — everyone else just browses.</p>
        <button onClick={google} disabled={busy} className="mt-4 w-full py-3 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 min-h-12 disabled:opacity-50" style={{ backgroundColor: RED }}>
          <LogIn className="w-4 h-4" /> Continue with Google
        </button>
        <div className="my-4 flex items-center gap-3 text-xs font-bold text-slate-400">
          <span className="flex-1 h-px bg-slate-200" /> or email <span className="flex-1 h-px bg-slate-200" />
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="Email" className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#A6192E]" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Password" onKeyDown={(e) => { if (e.key === "Enter") emailSignIn(); }} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#A6192E]" />
        <button onClick={emailSignIn} disabled={busy} className="mt-3 w-full py-3 rounded-full text-sm font-bold bg-slate-100 text-slate-700 min-h-12 disabled:opacity-50">Sign in</button>
        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

// ── review queue row ─────────────────────────────────────────────────────────
function SuggestionRow({ s, alreadyAdded, onApprove, onDismiss }) {
  const [confirming, setConfirming] = useState(false);
  const when = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {s.diagramImage ? <img src={s.diagramImage} alt="" className="w-20 h-20 rounded-xl object-cover border border-slate-200 flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ backgroundColor: RED }}>{s.cat || "Unsorted"}</span>
          <h3 className="mt-2 text-base font-bold leading-snug" style={{ color: RED }}>{s.name}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-400">
            Suggested by {s.suggestedByName || "a coach"}{when ? ` · ${when}` : ""}
          </p>
        </div>
        {alreadyAdded && (
          <span className="flex-shrink-0 text-[11px] font-black px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Already in the library</span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <a href={s.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-slate-100 text-slate-700 min-h-11">
          <Play className="w-3.5 h-3.5" /> Watch video
        </a>
        {!alreadyAdded && (
          <button onClick={onApprove} className="text-xs font-bold px-4 py-2.5 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>Add to library</button>
        )}
        {confirming ? (
          <button onClick={onDismiss} className="text-xs font-bold px-4 py-2.5 rounded-full bg-red-50 text-red-700 border border-red-200 min-h-11">Sure? Dismiss it</button>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-xs font-bold px-4 py-2.5 rounded-full bg-white border border-slate-200 text-slate-600 min-h-11">Dismiss</button>
        )}
      </div>
    </div>
  );
}

// ── app ────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const [drills, setDrills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [view, setView] = useState({ name: "library" }); // library | detail | form | inbox
  const [signInOpen, setSignInOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [printDrill, setPrintDrill] = useState(null); // drill open in the print preview (DrillPrintSheet)
  const [playDrill, setPlayDrill] = useState(null); // drill open in the animation player (BoardPlayer)
  const [incoming, setIncoming] = useState(() => parseIncoming());
  const [incomingStatus, setIncomingStatus] = useState(null); // saved | queued | already | error
  const [suggestions, setSuggestions] = useState([]);
  const timeoutRef = useRef(null);

  const isCoach = role === "admin" || role === "orgAdmin";
  // Who can BUILD drills (open the form, create/edit/delete, use the
  // studio): coaches plus the drillBuilder role — a person who builds drills
  // in this library but has no team-app access. The Review queue stays
  // coach-only (isCoach): a drillBuilder never sees it, approves, or
  // dismisses. Browsing stays public, suggesting stays any-signed-in-user.
  const canBuild = isCoach || role === "drillBuilder";

  // Incoming video-library pick → the review queue (limbo). Any signed-in
  // user can suggest; only coaches see the queue and approve. Runs once the
  // user and the drill list are known so the already-added check is real.
  // Params stay in the URL until the user signs in.
  useEffect(() => {
    if (!incoming || loading || !user) return;
    const inc = incoming;
    setIncoming(null);
    clearIncomingParams();
    (async () => {
      try {
        if (drills.some((d) => d.videoUrl && d.videoUrl === inc.videoUrl)) {
          setIncomingStatus("already");
          return;
        }
        const dup = await getDocs(query(collection(db, "drillSuggestions"), where("videoUrl", "==", inc.videoUrl)));
        if (!dup.empty) { setIncomingStatus("queued"); return; }
        await addDoc(collection(db, "drillSuggestions"), {
          ...inc,
          suggestedByUid: user.uid,
          suggestedByName: user.displayName || user.email || "Coach",
          createdAt: serverTimestamp(),
        });
        setIncomingStatus("saved");
      } catch {
        setIncomingStatus("error");
      }
    })();
    // drills intentionally left out: first load only, gated on loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, loading, user]);

  // Auth + role (role lives on the users doc the TeamHub app manages).
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    setRole(null);
    setRoleChecked(false);
    if (!u) { setRoleChecked(true); return; }
    try {
      const snap = await getDoc(doc(db, "users", u.uid));
      setRole(snap.exists() ? (snap.data().role || "player") : "player");
    } catch {
      setRole("player");
    } finally {
      setRoleChecked(true);
    }
  }), []);

  // Live drill list. If Firestore can't be reached (offline / sandbox), fall
  // back to the empty state after a short wait instead of spinning forever.
  useEffect(() => {
    timeoutRef.current = setTimeout(() => { setLoading(false); setOffline(true); }, 8000);
    const unsub = onSnapshot(
      query(collection(db, "drillLibrary"), orderBy("createdAt", "desc")),
      (snap) => {
        clearTimeout(timeoutRef.current);
        setDrills(snap.docs.map((d) => normalizeDrillDoc({ id: d.id, ...d.data() })));
        setLoading(false);
        setOffline(false);
      },
      () => { clearTimeout(timeoutRef.current); setLoading(false); setOffline(true); },
    );
    return () => { unsub(); clearTimeout(timeoutRef.current); };
  }, []);

  // Live review queue — coaches only.
  useEffect(() => {
    if (!isCoach || !user) { setSuggestions([]); return; }
    const unsub = onSnapshot(
      query(collection(db, "drillSuggestions"), orderBy("createdAt", "desc")),
      (snap) => setSuggestions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => unsub();
  }, [isCoach, user]);

  // Filter pills = the 17 built-in categories + any custom category a coach
  // added on a drill (same as the TeamHub app), so a new category shows up
  // to filter by as soon as a drill uses it.
  const cats = useMemo(() => {
    const set = new Set(DRILL_CATEGORIES);
    drills.forEach((d) => d.cat && set.add(d.cat));
    return [...set];
  }, [drills]);

  const counts = useMemo(() => {
    const c = { All: drills.length };
    for (const d of drills) c[d.cat] = (c[d.cat] || 0) + 1;
    return c;
  }, [drills]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drills.filter((d) => {
      if (d.kind && d.kind !== DRILL_KIND) return false; // legacy "point" items are not drills
      if (cat !== "All" && d.cat !== cat) return false;
      if (!q) return true;
      const hay = [d.name, d.title, d.cat, d.desc, d.howTo, ...(d.tags || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [drills, cat, search]);

  const openDetail = (id) => { setView({ name: "detail", id }); window.scrollTo(0, 0); };
  const openForm = (drill) => { setView({ name: "form", drill: drill || null }); window.scrollTo(0, 0); };
  const backToLibrary = () => { setView({ name: "library" }); window.scrollTo(0, 0); };

  const selected = view.name === "detail" ? drills.find((d) => d.id === view.id) : null;

  const handleDelete = async (id) => {
    try { await deleteDoc(doc(db, "drillLibrary", id)); backToLibrary(); }
    catch { setSaveMsg("Could not delete the drill — check your connection."); }
  };

  // Approve a suggestion: opens the quick-add form prefilled. Saving the
  // drill clears the suggestion from the queue. Cancelling leaves it there.
  const approveSuggestion = (s) => {
    setView({
      name: "form",
      drill: { name: s.name, cat: s.cat, videoUrl: s.videoUrl, desc: s.desc || "", info: s.info || "", tags: s.tags || [], diagramImage: s.diagramImage || "" },
      suggestionId: s.id,
    });
    window.scrollTo(0, 0);
  };
  const dismissSuggestion = async (id) => {
    try { await deleteDoc(doc(db, "drillSuggestions", id)); }
    catch { setSaveMsg("Could not dismiss that one — check your connection."); }
  };

  const handleSaved = async (id) => {
    if (view.suggestionId) {
      try { await deleteDoc(doc(db, "drillSuggestions", view.suggestionId)); } catch {}
    }
    setSaveMsg("Drill saved.");
    setTimeout(() => setSaveMsg(""), 4000);
    openDetail(id);
  };

  return (
    <>
    {/* .app-shell: hidden in print — only #print-sheet prints (see index.css). */}
    <div className="app-shell min-h-screen" style={{ backgroundColor: "#F4F6F8" }}>
      {/* header */}
      <header style={{ backgroundColor: RED }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FFFFFF" }}>
            <BookOpen className="w-6 h-6" style={{ color: RED }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: RED_LIGHT }}>Brophy College Prep</div>
            <h1 className="text-xl sm:text-2xl font-black leading-tight">Drill Library</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canBuild && (
              <button onClick={() => openForm(null)} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 text-white" style={{ backgroundColor: "#FFFFFF", color: RED }}>
                <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add drill</span><span className="sm:hidden">Add</span>
              </button>
            )}
            {isCoach && (
              <button onClick={() => setView({ name: "inbox" })} className="relative flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white/10 min-h-11">
                <Inbox className="w-4 h-4" /> <span className="hidden sm:inline">Review</span>
                {suggestions.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-white text-[11px] font-black flex items-center justify-center" style={{ color: RED }}>{suggestions.length}</span>
                )}
              </button>
            )}
            {user ? (
              <button onClick={() => signOut(auth)} title={user.email || ""} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white/10 min-h-11">
                <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">{user.displayName?.split(" ")[0] || "Coach"}</span>
              </button>
            ) : (
              <button onClick={() => setSignInOpen(true)} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full bg-white/10 min-h-11">
                <LogIn className="w-4 h-4" /> Coach sign in
              </button>
            )}
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-2 text-[11px] font-semibold text-white/60">
            One library for JVB, JVA and Varsity · Coaches and drill builders add the drills, everyone browses
          </div>
        </div>
      </header>

      {saveMsg && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5"><Check className="w-4 h-4" />{saveMsg}</p>
        </div>
      )}

      {incoming && !user && view.name === "library" && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm">
            <Plus className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />
            <span className="min-w-0 flex-1">Video to suggest: <span className="font-black">{incoming.name}</span>{incoming.cat ? ` · ${incoming.cat}` : ""}</span>
            <button onClick={() => setSignInOpen(true)} className="text-xs font-bold px-4 py-2.5 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>Sign in to send it</button>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-400 px-1">Sent from the Soccer Video Library. It lands in the review queue — Anthony checks it before it goes in the library.</p>
        </div>
      )}

      {incomingStatus && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <p className={`flex items-center gap-2 text-sm font-semibold rounded-xl px-3 py-2.5 border ${incomingStatus === "error" ? "text-red-700 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>
            <Check className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">
              {incomingStatus === "saved" && "Sent to the review queue — Anthony will check it before it goes in the library."}
              {incomingStatus === "queued" && "That video is already in the review queue."}
              {incomingStatus === "already" && "That drill is already in the library — no need to add it again."}
              {incomingStatus === "error" && "Couldn't send that — check your connection and try again."}
            </span>
            <button onClick={() => setIncomingStatus(null)} aria-label="Dismiss" className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"><X className="w-4 h-4" /></button>
          </p>
        </div>
      )}

      {offline && view.name === "library" && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <WifiOff className="w-4 h-4 mt-0.5 flex-shrink-0" />
            Couldn&apos;t reach the library — check your connection. Anything saved on this device still shows below.
          </p>
        </div>
      )}

      {view.name === "library" && (
        <main className="max-w-6xl mx-auto px-4 pb-16">
          {/* search + categories */}
          <div className="mt-5">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search drills — name, keyword, tag…"
                aria-label="Search drills"
                className="w-full bg-white border border-slate-200 rounded-full pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#A6192E] shadow-sm"
              />
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
              {["All", ...cats].map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`flex-shrink-0 text-xs font-bold px-3 py-2 rounded-full min-h-9 border ${cat === c ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-200"}`}
                  style={cat === c ? { backgroundColor: RED } : {}}
                >
                  {c}{counts[c] ? ` · ${counts[c]}` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* grid / empty state */}
          {loading ? (
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => <div key={i} className="bg-white rounded-2xl border border-slate-200 h-64 animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-10 bg-white rounded-3xl border border-dashed border-slate-300 px-6 py-14 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#EEF1F5" }}>
                <BookOpen className="w-7 h-7 text-slate-400" />
              </div>
              <h2 className="mt-4 text-lg font-black" style={{ color: RED }}>
                {drills.length === 0 ? "The library is empty — for now" : "No drills match that search"}
              </h2>
              <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
                {drills.length === 0
                  ? "Starting clean for Brophy. Coaches add the first drills here — each one gets a to-scale diagram, setup and coaching points."
                  : "Try a different keyword or category."}
              </p>
              {drills.length === 0 && canBuild && (
                <button onClick={() => openForm(null)} className="mt-5 inline-flex items-center gap-2 text-sm font-bold px-5 py-3 rounded-full text-white min-h-12" style={{ backgroundColor: RED }}>
                  <Plus className="w-4 h-4" /> Add the first drill
                </button>
              )}
              {drills.length === 0 && !canBuild && (
                <p className="mt-4 text-xs font-semibold text-slate-400">
                  {user ? (roleChecked ? "Your account can't add drills — only coaches and drill builders can." : "") : "Coaches and drill builders — sign in above to add drills."}
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">
                {filtered.length} drill{filtered.length === 1 ? "" : "s"}{cat !== "All" ? ` · ${cat}` : ""}
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((d) => <DrillCard key={d.id} drill={d} onOpen={() => openDetail(d.id)} />)}
              </div>
            </>
          )}
        </main>
      )}

      {view.name === "inbox" && isCoach && (
        <main className="max-w-3xl mx-auto px-4 pb-16">
          <button onClick={backToLibrary} className="mt-4 flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900 min-h-11">
            <ChevronLeft className="w-4 h-4" /> All drills
          </button>
          <h1 className="mt-2 text-2xl font-black" style={{ color: RED }}>Review queue</h1>
          <p className="mt-1 text-sm text-slate-500">Videos coaches sent from the Soccer Video Library. Add the ones worth keeping — each opens as a quick fill-in. Dismiss the rest, or the ones already in the library.</p>
          {suggestions.length === 0 ? (
            <div className="mt-6 bg-white rounded-3xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <Inbox className="w-8 h-8 mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-500">Nothing waiting — the queue is clear.</p>
              <p className="mt-1 text-xs text-slate-400">When a coach taps “Add to Brophy Library” in the video library, it shows up here.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.id}
                  s={s}
                  alreadyAdded={drills.some((d) => d.videoUrl && d.videoUrl === s.videoUrl)}
                  onApprove={() => approveSuggestion(s)}
                  onDismiss={() => dismissSuggestion(s.id)}
                />
              ))}
            </div>
          )}
        </main>
      )}
      {view.name === "inbox" && !isCoach && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 font-semibold">Only coaches can review suggestions.</p>
          <button onClick={backToLibrary} className="mt-4 text-sm font-bold px-4 py-3 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>Back to the library</button>
        </div>
      )}

      {view.name === "detail" && selected && (
        <DrillDetail
          drill={selected}
          canEdit={canBuild}
          onBack={backToLibrary}
          onEdit={() => openForm(selected)}
          onDuplicate={() => openForm({ ...selected, id: null, name: `${selected.name} (copy)` })}
          onDelete={() => handleDelete(selected.id)}
          onPrint={() => setPrintDrill(selected)}
          onPlay={() => setPlayDrill(selected)}
        />
      )}
      {view.name === "detail" && !selected && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 font-semibold">That drill isn&apos;t here anymore.</p>
          <button onClick={backToLibrary} className="mt-4 text-sm font-bold px-4 py-3 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>Back to the library</button>
        </div>
      )}

      {view.name === "form" && canBuild && (
        <DrillForm
          initial={view.drill || null}
          user={user}
          onCancel={backToLibrary}
          onSaved={handleSaved}
        />
      )}
      {view.name === "form" && !canBuild && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 font-semibold">Only coaches and drill builders can add or edit drills.</p>
          <button onClick={backToLibrary} className="mt-4 text-sm font-bold px-4 py-3 rounded-full text-white min-h-11" style={{ backgroundColor: RED }}>Back to the library</button>
        </div>
      )}

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}

      <footer className="border-t border-slate-200 py-6">
        <p className="text-center text-xs text-slate-400 px-4">
          Brophy College Prep Soccer · Drill Library — drills are added by Brophy coaches.
        </p>
      </footer>
    </div>

    {printDrill && <DrillPrintSheet drill={printDrill} onClose={() => setPrintDrill(null)} />}
    {playDrill && <BoardPlayer state={playDrill.diagramData} title={playDrill.title || playDrill.name} onClose={() => setPlayDrill(null)} />}
    </>
  );
}
