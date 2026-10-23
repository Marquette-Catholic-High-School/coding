# CodeClass

Classroom coding website: teachers create classes, students join with a code and code in a browser IDE; admins
install language packs and teachers design their own pseudocode languages.

- Architecture, contracts and feature spec: `docs/ARCHITECTURE.md` (read the relevant sections before changing code).
- UI rules (binding): `docs/UI-STYLE-GUIDE.md` — Mantine 9 + Tabler icons only, no hard-coded colors, light and dark.
- Commands: `npm run dev` · `npm run typecheck` · `npm test` · `npm run build && npm start`.
- Student code only ever runs in the browser (Web Workers / sandboxed iframe); never execute it on the server.
