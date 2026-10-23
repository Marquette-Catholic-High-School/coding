# CodeClass

A classroom coding website. Teachers create classes and assignments; students join with a class code and write,
run and submit code in a browser IDE. Admins install **language packs**. Teachers can also build their own
**pseudocode language** from the words the class has learned so far.

All student code runs **in the student's browser** (Web Workers and a sandboxed iframe). The server stores
accounts, classes and work, and never executes code.

## Quick start

Requires Node.js 22 or later (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://localhost:5173. On first run, CodeClass asks you to create the **admin account**. It also installs
JavaScript, Python and a *Classroom Pseudocode* language.

1. **Languages**: install more packs (TypeScript, Lua, SQL, Web page) or create pseudocode languages.
2. **Classes → New class**: pick the languages the class may use.
3. Share the class code or the join link (`/join/ABC123`) with students. They create their own accounts. You can also
   add students yourself from the class's **Students** tab, which hands out temporary passwords.
4. **New assignment**: write instructions (Markdown), choose the language, add starter code and input/output tests.
   You can mark tests as hidden, and **Fill expected outputs from a model solution** fills them in for you.
5. Students code, run tests and submit. You grade from the assignment page. **Autograde all** runs every test,
   hidden ones included, against every submission.

## Languages

| Pack | Runs on | Notes |
|---|---|---|
| Python 3.14 | Pyodide (loaded from jsDelivr on first run, ~10 MB, then cached) | `input()` works interactively |
| JavaScript | browser engine | `console.log`, `input()` / `prompt()` |
| TypeScript | sucrase (types stripped, not checked) | same as JavaScript |
| Lua 5.4 | wasmoon | `print`, `io.write`, `io.read` |
| SQL | SQLite via sql.js | results print as text tables; fresh database per run |
| Web page | sandboxed iframe | live preview + page console |
| Pseudocode | CodeClass's own interpreter | fully configurable, see below |

### Pseudocode builder

Under **Languages → (a pseudocode language)**:

- **Words**: choose the spelling(s) for every keyword, e.g. `DISPLAY` instead of `OUTPUT`, or `ENDIF` / `END IF`. The
  first spelling is the one shown to students. Switch a topic off ("not learned yet") and students get
  `You haven't learned "WHILE" yet.` instead of a confusing error.
- **Built-ins**: rename or switch off functions such as `LENGTH`, `RANDOM` and `APPEND`.
- **Rules**: case sensitivity, `END IF` vs `{ }` blocks, assignment arrows (`←`, `<-`, `=`), comment style, list
  indexes from 0 or 1, how `OUTPUT a, b` is joined.
- **Word bank**: the reference card students see beside the editor.
- **Try it**: run programs with your unsaved changes.

Presets to start from: *Classroom* (plain English), *Starter* (first lessons), *AP CSP*, *Cambridge* (IGCSE / 9618) and
*AQA* (GCSE).

## Production

```bash
npm run build
PORT=3000 npm start
```

One Node process serves the API and the built client. Configuration:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port (production) |
| `DATABASE_PATH` | `data/codeclass.db` | SQLite file. Back up this file (and its `-wal` file) |
| `COOKIE_SECURE` | unset | Set to `1` when served over HTTPS (recommended) |

Put CodeClass behind an HTTPS reverse proxy (Caddy, nginx). Responses carry `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers. Programs need them to pause for typed input, so the proxy must not strip them.

## Development

```bash
npm run typecheck   # shared, server, client
npm test            # vitest: engine, server API, runtime and IDE helpers
```

- `docs/ARCHITECTURE.md`: contracts, conventions and feature spec.
- `docs/UI-STYLE-GUIDE.md`: UI rules (Mantine 9, Tabler icons, light and dark mode).

## Limits worth knowing

- Test results that students see are computed in their browser, so a determined student could fake them. Hidden tests
  never leave the server for students, and **Autograde all** re-runs every test in the teacher's browser. Use those
  results when grading.
- Python needs the jsDelivr CDN on its first run in each browser. All other runtimes are bundled.
- Interactive input needs a modern browser with cross-origin isolation (current Chrome, Edge, Firefox and Safari).
  Without it, programs read from an "Input for your program" box instead.
