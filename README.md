# Brophy Drill Library

Standalone drill library for **Brophy College Prep soccer** (JVB, JVA, Varsity).
A reference site coaches and players browse on their own — separate from the
Brophy TeamHub app, which keeps its own drill set for building practice
sessions.

- **Public to browse** — no sign-in needed. Search by name/keyword/tag, filter
  by the 15 drill categories, open any drill for the full diagram, setup,
  how-to, objectives, coaching points and video.
- **Coaches only add/edit** — sign in with your Brophy Google account (or
  email/password). Only users with role `admin` or `orgAdmin` in the Brophy
  Firebase project can add, edit, duplicate or delete drills. Players can only
  view.
- **Diagram-first** — every drill is built on the same to-scale pitch board as
  the TeamHub app (full 115×75, half pitch, penalty box, grid), with the fixed
  5-arrow legend (pass = open head, run = dashed, dribble = wavy, shot = double
  line, direction = plain) and structured setup fields (yards, cones, balls,
  goals, mannequins, equipment).
- **Starts clean** — zero drills seeded. Coaches add the first ones.

## Stack

Vite + React 19 + Tailwind, Firebase Auth + Firestore. Same Brophy Firebase
project as the TeamHub app (`brophy-soccer-app`), but drills live in their own
`drillLibrary` collection — never the app's `drills` collection.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Static site (Vite build output in `dist/`). Point hosting at the repo the same
way the TeamHub app is hosted. No paid services — Firebase only.

**Firestore rules:** `firestore.rules` in this repo covers only this site.
Merge the `drillLibrary` block into the TeamHub app's `firestore.rules` in
`brophy-soccer-app` and deploy once from there — do not deploy this file on
its own, or it would overwrite the app's rules.

## Drill document shape (`drillLibrary/{id}`)

```js
{
  name: "Third-man break-out",
  cat: "Passing patterns",          // one of the 15 categories
  tags: ["rondo", "1v1"],
  dur: 12,                          // minutes
  players: "8 + 2 GKs",
  setup: {
    lengthYd: 30, widthYd: 20,
    cones: 8, balls: 4, goals: 2, mannequins: 0,
    equipment: ["bibs", "poles"]
  },
  diagramData: {                    // structured board state (v2)
    field: "grid", lengthYd: 30, widthYd: 20,
    tokens: [...], arrows: [...], zones: [...]
  },
  howTo: "Step one\nStep two",      // one step per line
  objectives: ["Third-man runs"],
  desc: "One or two lines on what the drill is for",
  info: "Coaching points",
  videoUrl: "https://www.youtube.com/watch?v=…",
  createdByUid: "…", createdByName: "Coach",
  createdAt: <timestamp>, updatedAt: <timestamp>
}
```

## Left for later

- **Video organization** — the library currently holds one optional video link
  per drill. A dedicated video section (curated lists, categories beyond the
  15 drill categories) is a separate pass.
- Drill photos (the board diagram is the source of truth for now).
- Print/PDF export of a drill.
