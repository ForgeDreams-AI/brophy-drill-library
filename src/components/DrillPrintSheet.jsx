// ─── Printable drill sheet ─────────────────────────────────────────────────
// A clean training card a coach can hand out: name, setup, diagram, how-to,
// objectives, coaching points. Opened from DrillDetail's "Print / Save PDF"
// button; the sheet's Print button calls window.print() and the user picks
// "Save as PDF" (or a printer) in the system dialog — no PDF library, no
// new dependency. Print CSS in index.css hides the whole app (.app-shell)
// and prints only #print-sheet. Anyone can print — printing is read-only.
// The diagram reuses the detail view's priority (photo → drawn board →
// raster PNG → placeholder) and the same BoardSvg renderer, so what prints
// is exactly what the detail view shows.

import { useEffect, useState } from "react";
import { Printer, X, LayoutGrid, Check } from "lucide-react";
import { BoardSvg } from "./TacticsBoard";

const RED = "#980000";
const lines = (t) => (t || "").split("\n").map((s) => s.trim()).filter(Boolean);

export default function DrillPrintSheet({ drill, onClose }) {
  const s = drill.setup || {};
  const [imgOk, setImgOk] = useState(true);
  const [imgReady, setImgReady] = useState(false);
  const imgSrc = drill.diagramImage || drill.diagram || "";
  // Same priority as DrillDetail: the photo wins while it loads; a failed
  // photo falls through to the drawn board, then the raster PNG.
  const showImage = Boolean(imgSrc) && imgOk;
  const needsImg = showImage;
  const howTo = lines(drill.howTo);

  const meta = [
    s.lengthYd && s.widthYd ? { k: "Grid", v: `${s.lengthYd} × ${s.widthYd} yd` } : null,
    s.cones ? { k: "Cones", v: String(s.cones) } : null,
    s.balls ? { k: "Balls", v: String(s.balls) } : null,
    s.goals ? { k: "Goals", v: String(s.goals) } : null,
    s.mannequins ? { k: "Mannequins", v: String(s.mannequins) } : null,
    drill.players ? { k: "Players", v: String(drill.players) } : null,
    drill.dur ? { k: "Minutes", v: `${drill.dur} min` } : null,
  ].filter(Boolean);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="print-overlay fixed inset-0 z-50 bg-black/60 overflow-y-auto" role="dialog" aria-label="Print preview">
      <div className="min-h-full flex flex-col items-center px-3 py-4 sm:py-8" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* toolbar — screen only, never prints */}
        <div className="print:hidden w-full max-w-[820px] flex items-center justify-between gap-3 mb-3">
          <p className="text-white text-sm font-bold">Print preview — this is exactly what prints</p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => window.print()}
              disabled={needsImg && !imgReady}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-full bg-white text-slate-900 min-h-11 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
            <button onClick={onClose} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-full bg-white/15 text-white min-h-11" aria-label="Close preview">
              <X className="w-4 h-4" /> Close
            </button>
          </div>
        </div>

        {/* the sheet */}
        <div id="print-sheet" className="w-full max-w-[820px] bg-white text-slate-900 shadow-2xl px-6 py-6 sm:px-9 sm:py-8">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Brophy College Prep · Soccer</p>
            <span className="sheet-cat inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: RED }}>
              {drill.cat}
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-black leading-tight" style={{ color: RED }}>{drill.title || drill.name}</h1>
          {drill.desc ? <p className="mt-2 text-sm text-slate-600 leading-relaxed">{drill.desc}</p> : null}

          {meta.length > 0 || (s.equipment && s.equipment.length > 0) ? (
            <div className="mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {meta.map((it) => (
                  <div key={it.k} className="rounded-xl border border-slate-300 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{it.k}</div>
                    <div className="text-sm font-bold text-slate-900">{it.v}</div>
                  </div>
                ))}
              </div>
              {s.equipment && s.equipment.length > 0 && (
                <p className="mt-2 text-sm text-slate-700"><span className="font-bold">Equipment: </span>{s.equipment.join(", ")}</p>
              )}
            </div>
          ) : null}

          {/* diagram — photo, drawn board, raster PNG, or a placeholder */}
          <div className="sheet-diagram mt-5">
            {showImage ? (
              <img
                src={imgSrc}
                alt="Drill diagram"
                className="w-full rounded-xl border border-slate-300"
                onLoad={() => setImgReady(true)}
                onError={() => { setImgOk(false); setImgReady(true); }}
              />
            ) : drill.diagramData ? (
              <div className="rounded-xl border border-slate-300 overflow-hidden">
                <BoardSvg state={drill.diagramData} showLegend className="w-full" />
              </div>
            ) : drill.diagram ? (
              <img
                src={drill.diagram}
                alt="Drill diagram"
                className="w-full rounded-xl border border-slate-300"
                onLoad={() => setImgReady(true)}
                onError={() => setImgReady(true)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 py-8 flex flex-col items-center gap-2 text-slate-400">
                <LayoutGrid className="w-8 h-8" />
                <span className="text-sm font-semibold">No diagram for this drill yet</span>
              </div>
            )}
          </div>

          {howTo.length > 0 && (
            <section className="mt-5">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">How to run it</h2>
              <ol className="mt-2 space-y-2">
                {howTo.map((step, i) => (
                  <li key={i} className="sheet-step flex gap-3">
                    <span className="sheet-step-num flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-black flex items-center justify-center" style={{ backgroundColor: RED }}>{i + 1}</span>
                    <span className="text-sm text-slate-800 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {drill.objectives && drill.objectives.length > 0 && (
            <section className="sheet-keep mt-5">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Look for</h2>
              <ul className="mt-2 space-y-1.5">
                {drill.objectives.map((o, i) => (
                  <li key={i} className="sheet-step flex gap-2 text-sm text-slate-800"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: RED }} />{o}</li>
                ))}
              </ul>
            </section>
          )}

          {drill.scenario ? (
            <section className="sheet-keep mt-5">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Scenario</h2>
              <p className="mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line">{drill.scenario}</p>
            </section>
          ) : null}

          {drill.cues && drill.cues.length > 0 && (
            <section className="sheet-keep mt-5">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Cues</h2>
              <ul className="mt-2 space-y-1.5">
                {drill.cues.map((c, i) => (
                  <li key={i} className="sheet-step flex gap-2 text-sm text-slate-800"><Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: RED }} />{c}</li>
                ))}
              </ul>
            </section>
          )}

          {drill.info ? (
            <section className="sheet-keep mt-5">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Coaching points</h2>
              <p className="mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-line">{drill.info}</p>
            </section>
          ) : null}

          <footer className="sheet-footer mt-6 pt-3 border-t border-slate-300 text-xs text-slate-500">
            <p className="font-bold text-slate-700">Brophy Drill Library · brophy-drill-library.web.app</p>
            {drill.videoUrl ? <p className="mt-0.5 break-all">Video: {drill.videoUrl}</p> : null}
            {drill.createdByName ? <p className="mt-0.5">Added by {drill.createdByName}</p> : null}
          </footer>
        </div>
      </div>
    </div>
  );
}
