# CodeClass — architecture & feature spec

CodeClass is a classroom coding site. Teachers/admins create classes; students join with a 6-character class code
and write code in a browser IDE. Admins install **language packs** (Python, JavaScript, TypeScript, Lua, SQL, Web page).
Teachers can also design their own **pseudocode languages**: they choose the words (`OUTPUT` vs `DISPLAY` vs `SAY`)
and switch constructs on as the class learns them ("words we've learned").

**All student code runs in the student's browser** (Web Workers / sandboxed iframe). The server never executes code.

UI rules: `docs/UI-STYLE-GUIDE.md` is binding (Mantine 9 only, Tabler icons only, no hard-coded colors, light + dark).

---

## 1. Layout & commands

```
shared/   @codeclass/shared — domain types, API contract (zod), language catalog, grading, pseudocode engine
server/   @codeclass/server — Express 5 + better-sqlite3 (sync). Entry src/index.ts, app in src/app.ts
client/   @codeclass/client — Vite 7 + React 19 + Mantine 9 + TanStack Query 5 + react-router 7
docs/     this file + UI style guide
```

| Command | What |
|---|---|
| `npm run dev` | API on :3001 (tsx watch) + Vite on :5173 (proxies `/api`) |
| `npm run typecheck` | `tsc --noEmit` for shared, server, client |
| `npm test` | vitest (shared + server tests + client unit tests); server tests use an in-memory DB per file |
| `npm run build && npm start` | production: one server on `PORT` (default 3000) serving API + `client/dist` |

Imports are extensionless (`moduleResolution: bundler`; tsx and Vite resolve `.ts`). `@codeclass/shared` and
`@codeclass/shared/pseudocode` are consumed as TypeScript source. TS is strict with `noUnusedLocals/Parameters`,
`verbatimModuleSyntax` (use `import type` for types).

## 2. Contracts (source of truth — read before writing code)

- `shared/src/types.ts` — domain objects (User, Language, ClassSummary, Assignment, Submission, …).
- `shared/src/api.ts` — every route, its zod request schema and response type. **Implement exactly these.**
- `shared/src/languages.ts` — `LANGUAGE_PACKS` catalog, `PYODIDE_INDEX_URL`, `kindSupportsTests/Input`.
- `shared/src/grading.ts` — `outputsMatch`, `inputLines`, `computeAutoScore`.
- `shared/src/pseudocode/types.ts` — pseudocode config + metadata + engine API types; `index.ts` is the engine API.
- `server/src/{db,auth,access,mappers,http}.ts` — schema/row types, sessions & guards, authorization helpers, row→API mappers, errors.
- `client/src/api/*.ts` — TanStack Query hooks for every endpoint (already written; add hooks only if missing).
- `client/src/runtime/{types,index,useCodeRunner}.ts` — code-runner contract.
- `client/src/ide/types.ts` — IDE component props (`CodeEditor`, `CodeWorkspace`, `WordBank`, `WebPreview`).
- `client/src/components/*` — PageHeader, QueryState/PageLoader/ErrorAlert, NotFoundCard, CopyIconButton, StatCard,
  badges (status/late/draft/due/language/count/tab-count/code/role/score, plus archived/joining-off/temp-password/
  language-disabled/unavailable-language/installed/not-learned), LanguageIcon, Markdown, BrandMark, notify, cards.module.css,
  RelativeTime ("in 3 days" + absolute tooltip), TemporaryPasswordModal (one-time credentials with copy buttons).

If a contract is genuinely wrong or missing something, make the smallest additive change and mention it in your
report. Never rename or remove contract members other code may use.

## 3. Server conventions

- One `Router` per file in `server/src/routes/`, exported as `router`, mounted at `/api` in `app.ts` — so define
  full paths like `router.get('/classes/:id', …)`.
- Express 5: async/sync handlers may `throw`; `HttpError`s become `{ error: { message, fieldErrors?, code? } }`;
  other errors that carry a 4xx status (bad URL encoding, unsupported charset) keep it, everything else is a 500.
- Validate bodies with `parseBody(schema, req.body)`; ids with `parseId(req.params.id)`.
- Auth: `currentUser(req)` (throws 401), guards `requireAuth`, `requireStaff`, `requireAdmin` (use as route
  middleware, e.g. `router.post('/x', requireStaff, handler)`). Admins can do everything teachers can, on every class.
- Authorization: `loadClassForStaff/ForMember`, `loadAssignmentForStaff/ForMember`, `loadLanguageRow` (throw 404/403).
- Mapping: `toUser`, `toLanguage` (+`LANGUAGE_SELECT`), `toClassSummary` (+`CLASS_SELECT`), `toAssignment` (strips hidden
  tests for students), `toSubmission` (synthesizes `not_started`), `isLate`, `toProject`.
- DB is synchronous better-sqlite3. Wrap multi-statement writes in `db.transaction(() => …)()`. Always set
  `updated_at = nowIso()` on updates. Booleans are 0/1; JSON columns via `JSON.stringify` / `parseJson`.
- 400 errors for a specific field use `badRequest(msg, { field: msg })`; uniqueness clashes use
  `conflict(msg, { field: msg })` so client forms can show them inline (field names = request schema keys).
- Never leak hidden tests or password hashes; never let a student read another student's data.
- Tests: `server/test/<area>.test.ts` with helpers in `server/test/helpers.ts` (`startTestServer`, `insertUser`,
  `clientAs`, `insertLanguage`). Each test file has its own in-memory DB.

## 4. Client conventions

- Pages live in `client/src/pages/<area>/`. Router (`client/src/router.tsx`) and role-switch pages
  (`DashboardPage`, `ClassesPage`, `ClassPage`, `AssignmentPage`) are already wired — implement the leaf pages.
  Routed pages are code-split (`lazyPage()` + `Suspense` with `PageLoader`); the guards and `AppLayout` stay eager.
- Every page: `usePageTitle(...)`, `PageHeader` first, data via the hooks in `client/src/api/*` rendered through
  `QueryState`; mutations show `notifySuccess` / `notifyError`; forms use `@mantine/form` uncontrolled mode
  (`mode: 'uncontrolled'`, `key={form.key('f')}`, `{...form.getInputProps('f')}`), `<form noValidate>`, and
  `form.setErrors(fieldErrors(err))` for 400/409 responses.
- Modals: `Modal title="Verb noun"`, footer `Group justify="flex-end"` with `Button variant="default"` Cancel + primary
  submit; destructive confirms via `modals.openConfirmModal` with `confirmProps: { color: 'red' }`.
- Tabs driven by `?tab=` (replace history). Tables: `Table.ScrollContainer minWidth={620}`, row action menus.
- Icon-only controls: `Tooltip` + `aria-label`. Status → badges from `components/badges.tsx` (no page-local badges).
- `useAuth()` / `useCurrentUser()` / `isStaff()` / `useSignOut()` from `auth/AuthProvider`. Signing out sets `['me']`
  to null in place and removes every other query (`auth/session.ts`); it never calls `queryClient.clear()`.
- Delete mutations refresh related queries with `refreshAfterDelete` (`api/deletedQueries.ts`): the deleted entity's
  own queries are not refetched (they would 404 on the page that is navigating away) and are dropped once unused.
- Dates: dayjs (`relativeTime` registered). Show relative time with the absolute date in a Tooltip.
- Full-height IDE pages: `CodeWorkspace` defaults to `height: calc(100dvh - 210px)` (min 520px). Pages that put a
  `PageHeader` above it keep the header compact (no subtitle) or pass a different height.

## 5. Code execution (client/src/runtime)

Contract in `runtime/types.ts` + `runtime/index.ts` + `runtime/useCodeRunner.ts`.

- Each run happens in a module Web Worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`).
  Keep one warm worker per language kind (Pyodide takes seconds to load); terminate on Stop/timeout and start fresh.
  JavaScript/TypeScript programs share the worker's realm (built-ins, leftover callbacks), so their worker is replaced
  after every run and the next one warmed up at once. `freshWorker` (`RunOptions`, `RunTestsOptions`, the options of
  `useCodeRunner`) gives a run, or a Python test batch, a worker of its own that is discarded afterwards: pass it
  when running other people's code (autograding, grading).
- **Network**: before student code runs, the worker's `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `Worker`, `importScripts`, … are replaced by functions that throw "Programs can't use the internet in CodeClass."
  (`runtime/lang/network.ts`). The Python worker does this once Pyodide has loaded and still lets `fetch` reach
  `PYODIDE_INDEX_URL` for packages; during a run Python can't import `js`, `pyodide_js`, `pyodide.code|ffi|http`,
  `pyodide_http` or `micropip` (a clear message, not a wall: the JavaScript-side block is what holds).
- **Input**: the page is cross-origin isolated (COOP/COEP headers in Vite and Express), so workers can block on
  `Atomics.wait` over a `SharedArrayBuffer` while the console asks the user for a line. Pre-supplied `stdin` lines are
  consumed first. Non-interactive runs (tests) treat exhausted input as end-of-file. If isolation is unavailable,
  interactive runs fall back to EOF and the IDE shows an "Input for your program" box instead. `endInput()` on the
  `RunHandle` / `CodeRunner` (Ctrl+D) ends the input: the waiting read and every later one get EOF (echoed as the
  system line "(end of input)"), so programs that read until end of input can finish.
- Languages: JavaScript (worker eval with `console.*`, `input()`/`prompt()` shims); TypeScript (sucrase strips types,
  then JS); Python (Pyodide from `PYODIDE_INDEX_URL`, fresh globals and original builtins each run; modules and files
  persist in a warm worker); Lua (wasmoon, wasm via `?url` import; `print`, `io.write`, `io.read`); SQL (sql.js, wasm
  via `?url`; fresh DB per run; every result set printed as a plain-text table); Pseudocode (`runPseudocode` from `@codeclass/shared/pseudocode` with the language's config);
  Web (not a console runner — `WebPreview` renders it).
- Output: a worker sends writes straight away until 20 messages went out in one ≈30 ms window, then batches them
  (programs that never yield would otherwise hold back their last lines). Held-back output is mirrored into a
  `SharedArrayBuffer` tail (`outputTail.ts`) that the page reads on Stop/timeout, so a program stuck in a loop still
  shows what it printed. Capped at 1 MB ("Output limit reached" system line). `useCodeRunner` keeps the transcript
  in a ref, publishes it at most once per animation frame and merges the oldest segments past 5000. Errors carry
  line numbers mapped to the student's source.
- `runTests`: for each test, non-interactive run with `inputLines(test.input)` as stdin, compare stdout with
  `outputsMatch(actual, expected, compareMode)`; passed = status ok && match; timeouts say "Took too long — is
  there a loop that never ends?".

## 6. Pseudocode engine (shared/src/pseudocode)

One engine, configured by `PseudocodeConfig`. Public API in `index.ts`: `checkPseudocode`, `runPseudocode`,
presets (`PSEUDOCODE_PRESETS`, `createPseudocodeConfig`, `normalizePseudocodeConfig`, `validatePseudocodeConfig`),
word bank helpers (`buildVocabulary`, `buildBuiltinVocabulary`, `highlightWords`, `renderExample`, `starterProgram`).

Language (Classroom wording; every keyword is the teacher's choice of spelling, case-insensitive unless configured):

```
// comment                         (commentPrefixes)
OUTPUT "Total: ", total            values joined by outputSeparator, then newline if outputNewline
INPUT name                         statement form; numeric-looking input becomes a number
SET score TO 0   /   score ← 0     assignment (set/to keywords, or any assignOperators at statement start)
x ← INPUT  /  x ← INPUT()  /  x ← INPUT("Age? ")   input as an expression (AQA USERINPUT, AP CSP INPUT())
IF cond THEN … ELSE IF cond THEN … ELSE … END IF          THEN optional
WHILE cond DO … END WHILE                                DO optional
REPEAT … UNTIL cond                                      post-test loop
REPEAT UNTIL cond … END REPEAT                           pre-test loop (AP CSP style)
REPEAT n TIMES … END REPEAT
FOR i FROM 1 TO 10 STEP 2 … END FOR                      FROM may also be ← / = ; END FOR may be followed by the variable (NEXT i)
FOR EACH item IN list … END FOR
FUNCTION f(a, b) … RETURN a + b … END FUNCTION           tolerate `a : INTEGER` param types and `RETURNS TYPE`
PROCEDURE p(a) … END PROCEDURE ;  CALL p(1)  or  p(1)
PROCEDURE swap(BYREF a, b)  /  (BYVAL a)                 BYREF lasts until BYVAL: the caller's variable or list item gets the final value
DECLARE x : INTEGER   /   DECLARE a, b : STRING          does nothing (names the variable)
DECLARE m : ARRAY[1:5] OF INTEGER                        m ← list of 5 defaults (0; "" for STRING/CHAR; FALSE for BOOLEAN); [1:3, 1:4] nests
CONSTANT PI ← 3.14  /  CONSTANT PI = 3.14                plain assignment (AQA spelling `constant`)
[1, 2, 3]   list[i]   list[i] ← v   grid[r, c] = grid[r][c]   listIndexBase 0 or 1
+ - * / DIV MOD ^   = == ≠ != <> < > <= >= ≤ ≥   AND OR NOT   TRUE FALSE   + or & joins text
```

Connector keywords (SET, TO, FROM, STEP, TIMES, DO, THEN, CALL, IN) are still names where a name is clearly meant —
before an assignment symbol, in a parameter or INPUT/DECLARE name list, or right after SET/FOR/FOR EACH/INPUT/DECLARE/
FUNCTION/PROCEDURE — and then also as values (`step ← 2 … FOR i FROM 1 TO 9 STEP step`), so words an exam board never
uses stay free for names. Every other keyword spelling is reserved.

`blockStyle: 'braces'` replaces `END X` with `{ … }` after a header (AP CSP: `IF (x > 3) { … } ELSE { … }`,
`REPEAT 3 TIMES { … }`, `PROCEDURE p(a) { … }`); `'both'` accepts either.

Semantics: `=`/`≠` compare a number with text that looks like that number as equal (`"1" = 1`, so `INPUT choice` …
`choice = "1"` works although numeric-looking input becomes a number); items inside lists compare strictly, and
`< > <= >=` between a number and text are an error whose hint says to drop the quote marks. Text functions, `[ ]` and
FOR EACH count an emoji as one character. `/` true division, `DIV`/`MOD` floor-based (Python-like); division by zero is an error; numbers print
without trailing `.0` and with float noise removed (`0.1 + 0.2` → `0.3`); booleans print as the teacher's TRUE/FALSE
spelling; lists print as `[1, 2, 3]` (strings inside lists quoted). Functions/procedures are hoisted; lookups go
local → global; assignment updates an existing local, else an existing global, else creates a local.
Step limit (default 5,000,000) and call-depth limit give friendly "never-ending loop" / "too much recursion" errors;
a list may hold at most 10,000,000 items (`l ← l + l` would otherwise exhaust memory within the step limit). Text that
grows too long and lists nested too deeply to print are reported at the statement that was running.

**Constructs switched off ("not learned yet")** are still recognised, so students get
`You haven't learned "WHILE" yet.` instead of a confusing parse error. Built-ins can be renamed or switched off.

`validatePseudocodeConfig` also rejects comment symbols that would swallow code written without spaces (`!` starts
`!=`; `--`, `*-`, `(-` appear in `5--2`, `x*-1`, `(-1)`; `normalizePseudocodeConfig` drops them from stored configs) and
two spellings of one keyword where one starts with the other (`PRINT` and `PRINT LINE` would read `PRINT line` as one
word). Keyword slots added later (`declare`, `constant`) are optional in the schema and filled with their defaults.

Error messages are for 11–16 year olds: say what's wrong, where (line/column), and a hint
(`Did you mean "OUTPUT"?` via edit distance against known words and variables). Examples:
`This IF on line 3 needs an END IF.` · `I don't know a variable called "scroe". Did you mean "score"?` ·
`List position 5 doesn't exist — the list has 3 items (positions 1 to 3).`

Presets (ids): `classroom` (default, plain English), `starter` (first lessons: output, variables, input only),
`ap-csp` (College Board AP CSP reference sheet: DISPLAY, INPUT(), ←, braces, REPEAT n TIMES, REPEAT UNTIL,
FOR EACH, PROCEDURE, RETURN, 1-based lists with APPEND/INSERT/REMOVE/LENGTH, RANDOM(a, b)),
`cambridge` (Cambridge IGCSE/A-Level 9618: DECLARE incl. ARRAY, CONSTANT, OUTPUT/INPUT, ←, IF THEN ELSE ENDIF,
WHILE DO ENDWHILE, REPEAT UNTIL, FOR ← TO STEP NEXT, PROCEDURE/ENDPROCEDURE with BYREF/BYVAL, FUNCTION/ENDFUNCTION,
CALL, MOD/DIV, LENGTH, `&` concatenation),
`aqa` (AQA GCSE: OUTPUT, USERINPUT, ←, `constant`, ENDIF/ENDWHILE/ENDFOR, SUBROUTINE/ENDSUBROUTINE, LEN, RANDOM_INT,
`#` comments).

## 7. Features by area

### 7.1 Setup, auth, accounts, users
- **First run**: `GET /api/setup` → `needsSetup` (no users). `POST /api/setup` (409 once any user exists) creates
  the admin and, in the same transaction, installs the `javascript` and `python` packs plus a pseudocode language
  `{ id: 'pseudocode', name: 'Classroom Pseudocode', config: createPseudocodeConfig('classroom'),
  starter_code: starterProgram(config), version: 'CodeClass pseudocode', owner: admin }` (skip rows that already
  exist), then signs in.
- **Login** by username or email (case-insensitive; `login` ≤ 254 chars, `password` ≤ 200). Wrong credentials → 401
  `Incorrect username or password` (no user enumeration). In-memory rate limit (`server/src/rateLimit.ts`):
  10 failures / 10 min per IP + hashed login → 429 with `Retry-After`.
- **Student registration** (`POST /api/auth/register`): join code must belong to a class that is join-enabled and not
  archived (else 400 `fieldErrors.joinCode`); username taken → 409 `fieldErrors.username`. Creates the student,
  enrolls, signs in. `GET /api/join/:code` is a public preview (404 when unknown). Unknown class codes on the
  preview, registration and `POST /classes/join` share a per-IP budget of 60 misses / 10 min → 429 (matching codes
  don't count).
- **Change password** verifies the current one (400 `fieldErrors.currentPassword`), clears `must_change_password`,
  and ends the user's other sessions. **Profile**: name + optional email (unique → 409 `fieldErrors.email`).
- **Users admin** (admin only): list with `classCount` (classes owned for staff, enrolled for students), create
  (temporary password via `generateTemporaryPassword()`, `must_change_password = 1`), edit (no self role change;
  at least one admin must remain), reset password (ends their sessions; not for yourself), delete (not yourself;
  409 for teachers who still own classes).
- UI: `SetupPage` (redirect to /login when not needed), `LoginPage` (redirect to /setup when needed; honours
  `?next=`; link to /join), `JoinPage` (/join and /join/:code — signed out: code + live class preview, then create
  account; signed-in student: join directly; staff: explain they can't join), `AccountPage` (profile, password,
  temp-password alert), `UsersPage` (tabs by role, table, create/edit/reset/delete, one-time temporary password modal
  with copy button).

### 7.2 Classes, roster, dashboards
- `GET /api/classes` (`?archived=1` for archived): teachers see classes they own, admins all; students their enrolled
  classes. `POST` requires ≥0 language ids that exist and are enabled (else 400 `fieldErrors.languageIds`); assigns a
  join code. `PATCH` may keep already-assigned disabled languages but new ones must be enabled.
  `POST /classes/:id/regenerate-code`, `DELETE /classes/:id`. `POST /classes/join` (students only; staff → 400):
  unknown/disabled/archived → 400 `fieldErrors.joinCode`; already enrolled → 200 (idempotent).
- Roster: stats per student — `submittedCount` (submitted|graded in this class), `lateCount` (published assignments
  where `isLate`), `averagePercent` (mean of grade/points×100 over graded, points > 0). `POST` adds a student: new
  username → create with temporary password; existing student → enroll (`temporaryPassword: null`; 409 if already
  enrolled; `email: null` in that response unless the caller is an admin or already teaches them); existing staff
  username → 409 `fieldErrors.username`. Remove = un-enroll only (work is kept).
  Reset password only for students enrolled in that class; a teacher (not an admin) gets 403 when the student is also
  in another teacher's class, since one password guards all their classes.
- Dashboards (`GET /api/dashboard`): staff → stats (classes, distinct students, to-grade = status submitted,
  late/missing = (student, published assignment) pairs where `isLate`), `toGrade` (10 oldest submitted),
  `upcoming` (published, due in the next 14 days, soonest first, max 8), `classes` (non-archived). Student →
  stats (classes, due within 7 days & not submitted, late, graded), classes, all published assignments in enrolled
  non-archived classes (not-submitted first by due date with no-due last, then submitted, then graded).
- UI: `TeacherClassesPage` (Active/Archived, link-card grid, first-run empty state, `CreateClassModal` exported from
  `pages/classes/CreateClassModal.tsx` for reuse; it requires at least one language), `TeacherClassPage` (header with big join-code chip + copy,
  "New assignment"; tabs Assignments | Students | Settings: assignment table with progress/late/to-grade/draft,
  roster with add/reset/remove + shareable join link `${origin}/join/${code}`, settings form for name/description/
  languages/join-enabled, regenerate code, archive, delete), `TeacherDashboard` (StatCards, needs-grading list,
  due-soon list with progress, classes grid, first-run empty state).

### 7.3 Assignments, submissions, grading
- Assignment language must be one of the class's languages (400 `fieldErrors.languageId`); an existing assignment may
  keep a language that was later disabled. Kinds that don't support tests (`web`) must have no tests. Test ids unique.
  `PATCH` can't lower `points` below an existing grade (400 `fieldErrors.points`); grades are never rescaled.
- `GET /classes/:id/assignments` order: due date ascending (no due date last), then newest. Staff rows carry class
  counts; student rows carry `myStatus/myLate/myGrade` and only published assignments.
- Student work: `GET/PUT /assignments/:id/submission` (PUT 409 when submitted — "Unsubmit to keep editing" — or
  graded), `POST /submit` (409 when graded, or past due with `allowLate` false unless the work was returned; stores
  visible-test results and `autoScore = computeAutoScore(visibleTests, results)`, which weights tests by points —
  0-point tests don't count, and if every test is 0 points they count equally), `POST /unsubmit` (only from
  submitted; clears `submitted_at`). Staff calling the student endpoints → 403.
- Teacher: `GET /assignments/:id/submissions` (one row per enrolled student, name order),
  `GET …/submissions/:studentId` (enrolled students only; prev/next in name order), `PATCH …/submissions/:studentId`
  (creates the row from starter code if needed; a non-null `grade` without `status` ⇒ graded with `graded_at`,
  `graded_by`; `status: 'in_progress'` returns work for revision keeping feedback and `submitted_at`, and sets
  `returned_at`/`returnedAt` when the work was submitted or graded; `status: 'submitted'` clears it; a PATCH with only
  `testResults/autoScore` leaves status unchanged). Returned work can be submitted after the due date even with
  `allowLate` false, and `isLate` is false while `returned_at` is set (also after it is handed in again and graded).
  `db.ts` `migrate()` adds `returned_at` to older databases (marking in-progress rows with feedback as returned).
- UI: `AssignmentEditorPage` (new + edit: details card with Markdown instructions write/preview, language from class
  languages, points, due date `DateTimePicker`, allow late, publish/draft; starter code `CodeEditor`; tests editor with
  compare mode, hidden/points per test, and "Fill expected output from a model solution" which runs a pasted
  solution against each input via `runTests`/`startRun`; "Preview as student" in a full-screen modal
  `CodeWorkspace`; sticky save bar; `useBlocker` for unsaved changes), `AssignmentOverviewPage` (teacher view of
  `/assignments/:id`: header with language/draft/due badges, Edit + Preview + "Autograde all" (runs every test incl.
  hidden for each submitted/graded submission in the teacher's browser and PATCHes `testResults/autoScore`), stat
  tiles, instructions accordion, students table filterable All / To grade / Missing), `GradingPage` (read-only
  `CodeWorkspace` with all tests incl. hidden; side card with status, late, auto score, "Use auto-score", grade
  `NumberInput` out of points, feedback, Save grade, Return for revision, prev/next student).

### 7.4 Student experience & playground
- `StudentDashboard` (StatCards, "To do" list, recently graded, join-class modal; first-run empty state asking for a
  class code), `StudentClassesPage` (class cards + join), `StudentClassPage` (assignment rows with language, due,
  status, late, grade), `StudentAssignmentPage` (compact header + `CodeWorkspace` with instructions, visible tests,
  word bank; autosave debounced ~1.5 s with "Saving… / Saved just now / Couldn't save — retry" status, flush on
  unmount and `beforeunload`; Submit runs the visible tests first and shows a summary in a confirm modal; submitted ⇒
  read-only + Unsubmit; graded ⇒ read-only with grade + feedback banner; returned (in progress with `returnedAt`) ⇒
  editable with a "Returned for revision" banner showing the feedback, never closed or late; closed when past due and
  late work not allowed).
- Playground (`/playground`, any role): `ProjectsPage` (cards, new-project modal with enabled-language select,
  rename, delete) and `ProjectPage` (`CodeWorkspace` + autosave; alert if the language is no longer installed).
  Server `projects.ts`: owner-only (404 otherwise); create requires an enabled language; code starts as the
  language's starter code; list newest-updated first.

### 7.5 Languages
- `GET /api/languages` (staff: all; students: enabled only), `GET /languages/catalog` (staff), `POST /languages/install`
  (admin; 409 if installed), `POST /languages/pseudocode` (staff; id `pseudo-<slug>` made unique; preset must exist,
  else 400 `fieldErrors.presetId`; `copyFromId` copies another pseudocode language's config; starter code from
  `starterProgram`), `GET/PATCH/DELETE /languages/:id` (edit = admin or owner of a pseudocode language;
  `pseudocode` only for pseudocode kind; `validatePseudocodeConfig` problems → 400 `fieldErrors.pseudocode`;
  DELETE → 409 while assignments use it).
- UI: `LanguagesPage` (tabs Installed | Catalog; installed cards with version, enabled, usage, owner; catalog cards
  with download size and input/tests support, Install for admins; "New pseudocode language" modal with preset cards
  (`.modeCard`) or copy-from), `LanguagePage`: packs → settings (name, description, enabled, starter code, try-it
  workspace, uninstall); pseudocode → **language builder**: tabs Words (per construct: "Learned" switch,
  keyword spellings via `TagsInput`, first = primary) | Built-ins (rename + enable) | Rules (case sensitivity, block
  style, assignment operators, comment prefixes, output separator/newline, list index base, text joining) |
  Word bank (`WordBank` preview) | Try it (live `CodeWorkspace` using the *draft* config); "Start from preset…";
  validation alert; sticky save bar + `useBlocker`; read-only view for non-editors.

### 7.6 IDE (client/src/ide)
- `CodeEditor`: CodeMirror 6 (`@codemirror/*` packages are installed; write a small React wrapper — no extra
  libraries). Modes: JS/TS, Python, SQL (SQLite), HTML, Lua (legacy mode via `StreamLanguage`), pseudocode
  (a `StreamLanguage` built from `highlightWords(config)`: multi-word keywords, locked keywords marked, builtins,
  constants, strings, numbers, comments; linting with `checkPseudocode`; keyword/builtin autocomplete). Light/dark
  themes from Mantine CSS variables (follow `useComputedColorScheme`), line numbers, bracket matching, history,
  search, `indentWithTab` with Escape-to-leave-editor, Ctrl/Cmd+Enter → `onRun`, `errorLine` highlight.
- `CodeWorkspace`: toolbar (Run/Stop with `Kbd` hint, Run tests, Clear, language badge, `toolbarRight` slot),
  resizable panels (Mantine `Splitter`): side panel tabs Instructions | Tests | Words (pseudocode only), editor, and a
  console (stdout, stderr in red, system lines dimmed, echoed input, inline input field while waiting with an
  "End input" button / Ctrl+D for programs that read until end of input, runtime-loading notice, "Finished in 0.2 s"
  footer, clickable error line → editor; renders only the last 2,000 output runs, with an "earlier output hidden"
  line). Stop (toolbar, and in the Tests tab while tests run) stops a program or a test run; a stopped test run shows
  what ran but isn't reported through `onTestResults`. The toolbar and the side tabs stay on one line (`useFitLevel`):
  the toolbar drops the shortcut hint, then shows Run tests as an icon, and only wraps as a last resort; the tabs
  become icon-only with tooltips. Kind `web`: `WebPreview` + console of `console.log`s instead; pages without
  scripts update as you type, pages with a `<script>` or `on…=` handler only on Run. Falls back to an "Input for your
  program" textarea when interactive input is unavailable. Stacks vertically on small screens.
- `WordBank`: constructs from `buildVocabulary` (learned first; locked greyed with a lock icon and "Not learned
  yet"), keyword chips, rendered examples, built-ins table.
- `WebPreview`: `iframe sandbox="allow-scripts allow-modals"` with `srcDoc` + injected console capture via
  `postMessage` (unique channel id; ignore other messages). `webPreviewDocument.ts` places the capture script first in
  `<head>` (ignoring comments and script/style/title text; before any earlier `<script>`), and `loopProtect.ts` adds
  a time-budget guard to every `while`/`do…while`/`for(;;)` condition in inline scripts: loops that keep the page busy
  for over 1 s throw "The loop on line N ran for more than 1 second…" into the page console.

## 8. Security notes
- Sessions: random 32-byte token in an httpOnly SameSite=Lax cookie; only its SHA-256 is stored. Passwords: scrypt.
- CSRF: non-GET `/api` requests must carry `x-codeclass: 1`. Every request with a valid session (GET included) must
  also send `x-codeclass-token` = the readable `cc_csrf` cookie (SHA-256 of `csrf:` + session token, set with `sid`).
  Exempt: `GET/POST /setup`, `POST /auth/login|register`, `GET /join/:code`. A missing/wrong token → 403 with
  `error.code: 'csrf'`, re-setting the cookie if it was missing or stale; the client wrapper (`client/src/api/client.ts`)
  reads `document.cookie` on every request and retries once on that 403. Student code runs in Web Workers on our origin
  (also when a teacher autogrades or previews it): its requests carry the cookies, but workers can't read them.
- The runner worker script is served with its own CSP (`server/src/app.ts` for `/assets/worker-*.js`, a Vite plugin in
  dev): `default-src 'none'`, scripts from self + the Pyodide CDN (with eval/wasm), `connect-src` only the Pyodide CDN
  and `<origin>/assets/` (`'self'` in dev), so student code can't reach `/api` in production.
- Students never receive hidden tests or other students' data. Teachers only manage their own classes (admins all).
- Student code runs only in browsers: Web Workers (no DOM, network APIs replaced, terminated on stop/timeout and
  JavaScript workers after every run; see §5) and a sandboxed iframe without
  `allow-same-origin` for web pages. Teacher-written Markdown is sanitized with DOMPurify.
