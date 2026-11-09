// ─── Brophy Drill Library ──────────────────────────────────────────────────
// Standalone reference library for Brophy College Prep soccer. Public to
// browse (no sign-in needed); only coaches (role admin / orgAdmin in the
// Brophy Firebase project) can add, edit or delete drills. Drills live in
// their own `drillLibrary` collection — never the TeamHub app's `drills`.
// The library starts clean: zero drills seeded.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, LogIn, LogOut, X, Clock, Users, LayoutGrid,
  ChevronLeft, Pencil, Copy, Trash2, Play, Link2, BookOpen,
  Layers, Check, AlertTriangle, WifiOff,
} from "lucide-react";
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, getDoc, serverTimestamp,
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import { auth, db } from "./firebase";
import { DRILL_CATEGORIES } from "./data/categories";
import TacticsBoard, { BoardSvg } from "./components/TacticsBoard";
import { ARROW_LEGEND, wavyPath } from "./components/boardData";

const NAVY = "#0F2A44";
const NAVY_DARK = "#0B1F33";
const GOLD = "#C9A227";
const GOLD_LIGHT = "#E7C65C";

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

const numOrNull = (v) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || Number.isNaN(n) ? null : n;
};

// ── the fixed 5-arrow legend, as chips (same legend as the board) ──────────
function LegendChips() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {ARROW_LEGEND.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
            {a.id === "dribble"
              ? <path d={wavyPath(1, 5, 25, 5, 2.5, 8)} fill="none" stroke={GOLD} strokeWidth={1.8} />
              : a.id === "shot"
                ? <g><line x1="1" y1="3" x2="25" y2="3" stroke={GOLD} strokeWidth={1.4} /><line x1="1" y1="7" x2="25" y2="7" stroke={GOLD} strokeWidth={1.4} /></g>
                : <line x1="1" y1="5" x2="25" y2="5" stroke={GOLD} strokeWidth={2} strokeDasharray={a.id === "run" ? "4 3" : undefined} />}
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
function DrillCard({ drill, onOpen }) {
  const s = drill.setup || {};
  return (
    <button
      onClick={onOpen}
      className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md hover:border-slate-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
    >
      <div className="aspect-[4/3] bg-white border-b border-slate-100 overflow-hidden flex items-center justify-center">
        {drill.diagramData
          ? <BoardSvg state={drill.diagramData} className="w-full h-full" />
          : (
            <div className="flex flex-col items-center gap-2 text-slate-300 px-4">
              <LayoutGrid className="w-10 h-10" />
              <span className="text-xs font-semibold text-slate-400">No diagram yet</span>
            </div>
          )}
      </div>
      <div className="p-4">
        <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ backgroundColor: NAVY }}>
          {drill.cat}
        </span>
        <h3 className="mt-2 text-base font-bold leading-snug" style={{ color: NAVY }}>{drill.name}</h3>
        {drill.desc ? <p className="mt-1 text-sm text-slate-500 line-clamp-2">{drill.desc}</p> : null}
        <div className="mt-3 flex items-center gap-3 text-xs font-semibold text-slate-500 flex-wrap">
          {s.lengthYd && s.widthYd ? <span>{s.lengthYd} × {s.widthYd} yd</span> : null}
          {drill.dur ? <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{drill.dur} min</span> : null}
          {drill.players ? <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{drill.players}</span> : null}
        </div>
      </div>
    </button>
  );
}

// ── drill detail ───────────────────────────────────────────────────────────
function DrillDetail({ drill, isCoach, onBack, onEdit, onDuplicate, onDelete }) {
  const s = drill.setup || {};
  const embed = youTubeEmbed(drill.videoUrl);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
          <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ backgroundColor: NAVY }}>
            {drill.cat}
          </span>
          <h1 className="mt-2 text-2xl sm:text-3xl font-black leading-tight" style={{ color: NAVY }}>{drill.name}</h1>
          {drill.desc ? <p className="mt-2 text-slate-600 leading-relaxed">{drill.desc}</p> : null}
        </div>
        {isCoach && (
          <div className="flex items-center gap-2 flex-shrink-0">
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
          </div>
        )}
      </div>

      {/* diagram */}
      {drill.diagramData ? (
        <div className="mt-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <BoardSvg state={drill.diagramData} showLegend className="w-full" />
          <div className="px-4 py-3 border-t border-slate-100"><LegendChips /></div>
        </div>
      ) : (
        <div className="mt-5 bg-white rounded-2xl border border-dashed border-slate-300 py-10 flex flex-col items-center gap-2 text-slate-400">
          <LayoutGrid className="w-8 h-8" />
          <span className="text-sm font-semibold">No diagram for this drill yet</span>
        </div>
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
                <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-black flex items-center justify-center" style={{ backgroundColor: NAVY }}>{i + 1}</span>
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
              <li key={i} className="flex gap-2 text-sm text-slate-700"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: GOLD }} />{o}</li>
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

// ── coach drill form (add / edit / duplicate) ──────────────────────────────
const BLANK_FORM = {
  name: "", cat: DRILL_CATEGORIES[0], tags: "", dur: "", players: "",
  setupLengthYd: "", setupWidthYd: "", setupCones: "", setupBalls: "",
  setupGoals: "", setupMannequins: "", equipment: "",
  howTo: "", objectives: "", desc: "", info: "", videoUrl: "", diagramData: null,
};

function drillToForm(d) {
  const s = d.setup || {};
  return {
    name: d.name || "", cat: d.cat || DRILL_CATEGORIES[0],
    tags: (d.tags || []).join(", "), dur: d.dur ?? "", players: d.players || "",
    setupLengthYd: s.lengthYd ?? "", setupWidthYd: s.widthYd ?? "",
    setupCones: s.cones ?? "", setupBalls: s.balls ?? "",
    setupGoals: s.goals ?? "", setupMannequins: s.mannequins ?? "",
    equipment: (s.equipment || []).join(", "),
    howTo: d.howTo || "", objectives: (d.objectives || []).join("\n"),
    desc: d.desc || "", info: d.info || "", videoUrl: d.videoUrl || "",
    diagramData: d.diagramData || null,
  };
}

function DrillForm({ initial, onCancel, onSaved, user }) {
  const [form, setForm] = useState(() => (initial ? drillToForm(initial) : BLANK_FORM));
  const [boardOpen, setBoardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(initial && initial.id);

  const save = async () => {
    if (!form.name.trim()) { setError("Give the drill a name."); return; }
    setSaving(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      cat: form.cat,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      dur: numOrNull(form.dur),
      players: form.players.trim(),
      setup: {
        lengthYd: numOrNull(form.setupLengthYd),
        widthYd: numOrNull(form.setupWidthYd),
        cones: numOrNull(form.setupCones),
        balls: numOrNull(form.setupBalls),
        goals: numOrNull(form.setupGoals),
        mannequins: numOrNull(form.setupMannequins),
        equipment: form.equipment.split(",").map((t) => t.trim()).filter(Boolean),
      },
      diagramData: form.diagramData || null,
      howTo: form.howTo.trim(),
      objectives: lines(form.objectives),
      desc: form.desc.trim(),
      info: form.info.trim(),
      videoUrl: form.videoUrl.trim(),
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

  const inputCls = "w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-[#C9A227]";
  const labelCls = "block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1";

  return (
    <div className="max-w-2xl mx-auto px-4 pb-16">
      <button onClick={onCancel} className="mt-4 flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900 min-h-11">
        <ChevronLeft className="w-4 h-4" /> Cancel
      </button>
      <h1 className="mt-2 text-2xl font-black" style={{ color: NAVY }}>{isEdit ? "Edit drill" : "Add a drill"}</h1>
      <p className="mt-1 text-sm text-slate-500">Only coaches can add drills. Build the diagram on the board, then fill in the setup — the board and the setup stay in sync.</p>

      <div className="mt-5 space-y-4 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
        <div>
          <label className={labelCls} htmlFor="f-name">Drill name *</label>
          <input id="f-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Third-man break-out" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="f-cat">Category</label>
            <select id="f-cat" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} className={inputCls}>
              {DRILL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="f-tags">Tags (comma separated)</label>
            <input id="f-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="rondo, 1v1" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-dur">Duration (minutes)</label>
            <input id="f-dur" type="number" min={1} value={form.dur} onChange={(e) => setForm({ ...form, dur: e.target.value })} placeholder="12" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="f-players">Players</label>
            <input id="f-players" value={form.players} onChange={(e) => setForm({ ...form, players: e.target.value })} placeholder="e.g. 8 + 2 GKs" className={inputCls} />
          </div>
        </div>

        {/* board */}
        <div>
          <span className={labelCls}>Diagram</span>
          {form.diagramData ? (
            <div className="relative">
              <BoardSvg state={form.diagramData} showLegend className="w-full rounded-xl border border-slate-200" />
              <button type="button" onClick={() => setForm({ ...form, diagramData: null })} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 border border-slate-200 flex items-center justify-center shadow" aria-label="Remove diagram">
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          ) : null}
          <button type="button" onClick={() => setBoardOpen(true)} className="mt-2 w-full py-3 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 min-h-12" style={{ backgroundColor: NAVY }}>
            <Layers className="w-4 h-4" /> {form.diagramData ? "Edit board" : "Build on the board"}
          </button>
          <p className="mt-1.5 text-xs text-slate-400">Place players, cones, goals and arrows on a to-scale pitch. Saving the board fills in the grid size below.</p>
        </div>

        {/* setup */}
        <div>
          <span className={labelCls}>Setup</span>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">Grid length (yd)
              <input type="number" min={5} value={form.setupLengthYd} onChange={(e) => setForm({ ...form, setupLengthYd: e.target.value })} placeholder="30" className={`${inputCls} mt-0.5 text-center`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">Grid width (yd)
              <input type="number" min={5} value={form.setupWidthYd} onChange={(e) => setForm({ ...form, setupWidthYd: e.target.value })} placeholder="20" className={`${inputCls} mt-0.5 text-center`} />
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            <label className="text-xs font-semibold text-slate-600">Cones<input type="number" min={0} value={form.setupCones} onChange={(e) => setForm({ ...form, setupCones: e.target.value })} placeholder="0" className={`${inputCls} mt-0.5 text-center`} /></label>
            <label className="text-xs font-semibold text-slate-600">Balls<input type="number" min={0} value={form.setupBalls} onChange={(e) => setForm({ ...form, setupBalls: e.target.value })} placeholder="0" className={`${inputCls} mt-0.5 text-center`} /></label>
            <label className="text-xs font-semibold text-slate-600">Goals<input type="number" min={0} value={form.setupGoals} onChange={(e) => setForm({ ...form, setupGoals: e.target.value })} placeholder="0" className={`${inputCls} mt-0.5 text-center`} /></label>
            <label className="text-xs font-semibold text-slate-600">Mannequins<input type="number" min={0} value={form.setupMannequins} onChange={(e) => setForm({ ...form, setupMannequins: e.target.value })} placeholder="0" className={`${inputCls} mt-0.5 text-center`} /></label>
          </div>
          <label className="block text-xs font-semibold text-slate-600 mt-3">Equipment (comma separated)
            <input value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="bibs, poles, hurdles" className={`${inputCls} mt-0.5`} />
          </label>
        </div>

        <div>
          <label className={labelCls} htmlFor="f-desc">Description</label>
          <textarea id="f-desc" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} rows={2} placeholder="One or two lines on what the drill is for" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-howto">How to run it — one step per line</label>
          <textarea id="f-howto" value={form.howTo} onChange={(e) => setForm({ ...form, howTo: e.target.value })} rows={4} placeholder={"Set the grid\nSplit into two teams\nPlay 3 minutes, then rotate"} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-obj">Look for — one goal per line</label>
          <textarea id="f-obj" value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} rows={3} placeholder={"Third-man runs\nQuick combination play"} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-info">Coaching points</label>
          <textarea id="f-info" value={form.info} onChange={(e) => setForm({ ...form, info: e.target.value })} rows={3} placeholder="What to say, what to correct, when to stop and coach" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="f-video">Video URL (optional)</label>
          <input id="f-video" value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" className={inputCls} />
        </div>

        {error ? <p className="flex items-start gap-2 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}</p> : null}

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-3 rounded-full text-sm font-bold bg-slate-100 text-slate-700 min-h-12">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-full text-sm font-bold text-white min-h-12 disabled:opacity-50" style={{ backgroundColor: NAVY }}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add drill"}
          </button>
        </div>
      </div>

      {boardOpen && (
        <TacticsBoard
          initial={form.diagramData}
          onSave={(_blob, state) => {
            setForm((p) => ({ ...p, diagramData: state, setupLengthYd: state?.lengthYd ?? p.setupLengthYd, setupWidthYd: state?.widthYd ?? p.setupWidthYd }));
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
          <h2 className="text-lg font-black" style={{ color: NAVY }}>Coach sign in</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-4 h-4 text-slate-600" /></button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Sign in with your Brophy account. Only coaches can add or edit drills — players just browse.</p>
        <button onClick={google} disabled={busy} className="mt-4 w-full py-3 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 min-h-12 disabled:opacity-50" style={{ backgroundColor: NAVY }}>
          <LogIn className="w-4 h-4" /> Continue with Google
        </button>
        <div className="my-4 flex items-center gap-3 text-xs font-bold text-slate-400">
          <span className="flex-1 h-px bg-slate-200" /> or email <span className="flex-1 h-px bg-slate-200" />
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="Email" className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Password" onKeyDown={(e) => { if (e.key === "Enter") emailSignIn(); }} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        <button onClick={emailSignIn} disabled={busy} className="mt-3 w-full py-3 rounded-full text-sm font-bold bg-slate-100 text-slate-700 min-h-12 disabled:opacity-50">Sign in</button>
        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
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
  const [view, setView] = useState({ name: "library" }); // library | detail | form
  const [signInOpen, setSignInOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const timeoutRef = useRef(null);

  const isCoach = role === "admin" || role === "orgAdmin";

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
        setDrills(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setOffline(false);
      },
      () => { clearTimeout(timeoutRef.current); setLoading(false); setOffline(true); },
    );
    return () => { unsub(); clearTimeout(timeoutRef.current); };
  }, []);

  const counts = useMemo(() => {
    const c = { All: drills.length };
    for (const d of drills) c[d.cat] = (c[d.cat] || 0) + 1;
    return c;
  }, [drills]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drills.filter((d) => {
      if (cat !== "All" && d.cat !== cat) return false;
      if (!q) return true;
      const hay = [d.name, d.cat, d.desc, d.howTo, ...(d.tags || [])].join(" ").toLowerCase();
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

  const handleSaved = (id) => {
    setSaveMsg("Drill saved.");
    setTimeout(() => setSaveMsg(""), 4000);
    openDetail(id);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F6F8" }}>
      {/* header */}
      <header style={{ backgroundColor: NAVY }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: GOLD }}>
            <BookOpen className="w-6 h-6" style={{ color: NAVY }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: GOLD_LIGHT }}>Brophy College Prep</div>
            <h1 className="text-xl sm:text-2xl font-black leading-tight">Drill Library</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isCoach && (
              <button onClick={() => openForm(null)} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-full min-h-11 text-white" style={{ backgroundColor: GOLD, color: NAVY }}>
                <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add drill</span><span className="sm:hidden">Add</span>
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
            One library for JVB, JVA and Varsity · Coaches add the drills, everyone browses
          </div>
        </div>
      </header>

      {saveMsg && (
        <div className="max-w-6xl mx-auto px-4 mt-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5"><Check className="w-4 h-4" />{saveMsg}</p>
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
                className="w-full bg-white border border-slate-200 rounded-full pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] shadow-sm"
              />
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
              {["All", ...DRILL_CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`flex-shrink-0 text-xs font-bold px-3 py-2 rounded-full min-h-9 border ${cat === c ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-200"}`}
                  style={cat === c ? { backgroundColor: NAVY } : {}}
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
              <h2 className="mt-4 text-lg font-black" style={{ color: NAVY }}>
                {drills.length === 0 ? "The library is empty — for now" : "No drills match that search"}
              </h2>
              <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
                {drills.length === 0
                  ? "Starting clean for Brophy. Coaches add the first drills here — each one gets a to-scale diagram, setup and coaching points."
                  : "Try a different keyword or category."}
              </p>
              {drills.length === 0 && isCoach && (
                <button onClick={() => openForm(null)} className="mt-5 inline-flex items-center gap-2 text-sm font-bold px-5 py-3 rounded-full text-white min-h-12" style={{ backgroundColor: NAVY }}>
                  <Plus className="w-4 h-4" /> Add the first drill
                </button>
              )}
              {drills.length === 0 && !isCoach && (
                <p className="mt-4 text-xs font-semibold text-slate-400">
                  {user ? (roleChecked ? "Your account isn't a coach account, so you can't add drills." : "") : "Coaches — sign in above to add drills."}
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

      {view.name === "detail" && selected && (
        <DrillDetail
          drill={selected}
          isCoach={isCoach}
          onBack={backToLibrary}
          onEdit={() => openForm(selected)}
          onDuplicate={() => openForm({ ...selected, id: null, name: `${selected.name} (copy)` })}
          onDelete={() => handleDelete(selected.id)}
        />
      )}
      {view.name === "detail" && !selected && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 font-semibold">That drill isn&apos;t here anymore.</p>
          <button onClick={backToLibrary} className="mt-4 text-sm font-bold px-4 py-3 rounded-full text-white min-h-11" style={{ backgroundColor: NAVY }}>Back to the library</button>
        </div>
      )}

      {view.name === "form" && isCoach && (
        <DrillForm
          initial={view.drill || null}
          user={user}
          onCancel={backToLibrary}
          onSaved={handleSaved}
        />
      )}
      {view.name === "form" && !isCoach && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 font-semibold">Only coaches can add or edit drills.</p>
          <button onClick={backToLibrary} className="mt-4 text-sm font-bold px-4 py-3 rounded-full text-white min-h-11" style={{ backgroundColor: NAVY }}>Back to the library</button>
        </div>
      )}

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}

      <footer className="border-t border-slate-200 py-6">
        <p className="text-center text-xs text-slate-400 px-4">
          Brophy College Prep Soccer · Drill Library — drills are added by Brophy coaches.
        </p>
      </footer>
    </div>
  );
}
