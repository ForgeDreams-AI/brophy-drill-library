#!/usr/bin/env node
/* global process, require */
// (Node script — `process`/`require` are Node globals; the repo's lint
// config is browser-only, so they are declared here instead.)
// ─── Migrate drills → the canonical `drillLibrary` collection ──────────────
// ONE-TIME script for the 2026-11-09 unification: the TeamHub app and the
// standalone Drill Library site now BOTH read and write `drillLibrary`.
// This copies every real drill from the old `drills` collection into
// `drillLibrary` (kind === "point" coaching-point items are SKIPPED — they
// are not drills and stay in `drills`, unread).
//
// DEDUPE: a source drill is skipped if `drillLibrary` already has a doc
// with the same non-empty videoUrl, else the same normalized name
// (lowercased, trimmed, whitespace collapsed). A skipped doc is logged,
// never overwritten.
//
// WHAT IS COPIED: the whole document as-is (the canonical shape is a
// superset of both apps' fields — see src/lib/drillDoc.js), plus:
//   kind: "drill" (set when missing), migratedFrom: "drills",
//   migratedAt: server timestamp. createdAt is preserved. createdByUid is
//   NOT stamped — the original author is unknown; the Admin SDK bypasses
//   the create rule, and later client edits only need isAdmin().
//
// HOW TO RUN (Google Cloud Shell, signed in as logan.abele — the project
// owner; this VM cannot reach Firestore):
//   1. cd into this repo on Cloud Shell (or any machine with the service
//      account key), then install the one dependency:
//        npm install firebase-admin
//   2. Get a service-account key for the brophy-soccer-app project:
//      Firebase Console → Project settings → Service accounts →
//      Generate new private key. Save it as service-account.json
//      (NEVER commit it — it is a secret; keep it out of git).
//   3. Dry run first (default — reads only, writes nothing):
//        GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//          node work/migrate-drills-to-canonical.js
//   4. When the dry run looks right, apply it:
//        GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//          node work/migrate-drills-to-canonical.js --apply
//   5. Verify in the Firestore console: `drillLibrary` holds the copied
//      docs, `drills` is untouched. Then delete service-account.json.
//
// RUN ORDER: deploy the new code for BOTH apps first, then the new rules
// (which drop the old /drills rule), THEN run this script. Running the
// script first is also safe (it only adds to drillLibrary), but the new
// code must be live before coaches create drills, or their new drills
// would land in the old collection and be missed by the migration.

const admin = require("firebase-admin");

const PROJECT_ID = "brophy-soccer-app";
const SOURCE = "drills";
const TARGET = "drillLibrary";
const BATCH_SIZE = 400; // Firestore batch limit is 500; stay under it.

const APPLY = process.argv.includes("--apply");

function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("ERROR: set GOOGLE_APPLICATION_CREDENTIALS to the service-account JSON path.");
    console.error("  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node work/migrate-drills-to-canonical.js [--apply]");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
  const db = admin.firestore();
  console.log(APPLY ? "MODE: --apply (will write)" : "MODE: --dry-run (no writes; pass --apply to write)");

  // Existing target docs, for dedupe.
  const targetSnap = await db.collection(TARGET).get();
  const byVideoUrl = new Set();
  const byName = new Set();
  targetSnap.forEach((d) => {
    const data = d.data();
    if (typeof data.videoUrl === "string" && data.videoUrl.trim()) byVideoUrl.add(data.videoUrl.trim());
    if (typeof data.name === "string" && data.name.trim()) byName.add(normName(data.name));
  });
  console.log(`Target ${TARGET}: ${targetSnap.size} existing doc(s).`);

  const sourceSnap = await db.collection(SOURCE).get();
  console.log(`Source ${SOURCE}: ${sourceSnap.size} doc(s).`);

  let copied = 0, skippedPoint = 0, skippedNoName = 0, skippedDupUrl = 0, skippedDupName = 0;
  let batch = db.batch();
  let batchCount = 0;
  const flush = async () => {
    if (batchCount === 0) return;
    if (APPLY) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const doc of sourceSnap.docs) {
    const data = doc.data();
    const label = `${doc.id} (${JSON.stringify(data.name || "")})`;
    if (data.kind === "point") {
      skippedPoint++;
      console.log(`SKIP ${label} — kind === "point" (coaching-point item, not a drill)`);
      continue;
    }
    if (!data.name || !String(data.name).trim()) {
      skippedNoName++;
      console.log(`SKIP ${label} — no name (cannot satisfy the drillLibrary create rule)`);
      continue;
    }
    const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl.trim() : "";
    if (videoUrl && byVideoUrl.has(videoUrl)) {
      skippedDupUrl++;
      console.log(`SKIP ${label} — duplicate videoUrl already in ${TARGET}`);
      continue;
    }
    if (byName.has(normName(data.name))) {
      skippedDupName++;
      console.log(`SKIP ${label} — duplicate name already in ${TARGET}`);
      continue;
    }
    const payload = {
      ...data,
      kind: "drill",
      migratedFrom: SOURCE,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (APPLY) {
      batch.set(db.collection(TARGET).doc(), payload);
      batchCount++;
      if (batchCount >= BATCH_SIZE) await flush();
    }
    byVideoUrl.add(videoUrl);
    byName.add(normName(data.name));
    copied++;
    console.log(`${APPLY ? "COPY " : "WOULD COPY "}${label}`);
  }
  await flush();

  console.log("── summary ──");
  console.log(`source docs:        ${sourceSnap.size}`);
  console.log(`${APPLY ? "copied:             " : "would copy:         "}${copied}`);
  console.log(`skipped (point):    ${skippedPoint}`);
  console.log(`skipped (no name):  ${skippedNoName}`);
  console.log(`skipped (dup url):  ${skippedDupUrl}`);
  console.log(`skipped (dup name): ${skippedDupName}`);
  if (!APPLY) console.log("Dry run only — nothing was written. Re-run with --apply to migrate.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
