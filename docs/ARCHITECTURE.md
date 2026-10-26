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
| `sudo deploy/install.sh` | Ubuntu server install (Node 24, Caddy HTTPS, systemd); then `codeclass-update` / `codeclass-uninstall` (see README) |

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
  language-disabled/unavailable-language/installed/not-learned/invite-outcome), LanguageIcon, Markdown, BrandMark, notify, cards.module.css,
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
  tests for students; needs a student's own submission to decide whether to send the solution), `toSubmission` (synthesizes `not_started`), `isLate`, `toProject`.
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
  (programs that never yield would otherwise hold back their last lines). When the page is cross-origin isolated,
  every write is also mirrored into a `SharedArrayBuffer` tail (`outputTail.ts`) that holds the output the page has
  not received yet. The worker drops batches once they arrive, and the tail has room for the whole output cap. The
  page reads the tail every 100 ms while the program runs, and once more on Stop, timeout or a worker crash. Batches
  that arrive later leave out what the tail already showed. So a program busy in a long computation or stuck in a
  loop shows everything it printed, up to the cap, within about 100 ms. Without isolation there is no tail: output
  held back during a flood shows when the program next prints or yields, and is lost if the program is stopped first.
  Capped at 1 MB ("Output limit reached" system line). `useCodeRunner` keeps the transcript
  in a ref, publishes it at most once per animation frame and merges the oldest segments past 5000. Errors carry
  line numbers mapped to the student's source.
- `runTests`: for each test, non-interactive run with `inputLines(test.input)` as stdin, compare stdout with
  `outputsMatch(actual, expected, compareMode)`; passed = status ok && match; timeouts say "Took too long — is
  there a loop that never ends?". `RunOutcome.started` (the worker reached the running phase) and `readInput` (the
  program asked for a line, even where running out isn't an error: JavaScript's prompt(), Lua's io.read()) let
  callers tell the program's results from the code runner's: `runnerFailed(outcome)` = errored before it started
  (runtime couldn't load, worker crashed); `onRunnerError` reports such tests.

## 6. Pseudocode engine (shared/src/pseudocode)

One engine, configured by `PseudocodeConfig`. Public API in `index.ts`: `checkPseudocode`, `runPseudocode`,
presets (`PSEUDOCODE_PRESETS`, `createPseudocodeConfig`, `normalizePseudocodeConfig`, `validatePseudocodeConfig`,
`COMMENT_PREFIXES`),
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
FUNCTION/PROCEDURE (`FOR EACH from IN list`) — and then also as values (`step ← 2 … FOR i FROM 1 TO 9 STEP step`), so
words an exam board never uses stay free for names. After an IF / WHILE whose THEN / DO is left out, such a name may
start the block (`then[1] ← 2`, `do(i)`). DECLARE and CONSTANT (added later) are keywords only at the start of an
instruction followed by a name (`CONSTANT PI ← 3.14`, `DECLARE x : INTEGER`); everywhere else, and in
`constant ← 9.81`, `declare[1] ← 2` or `declare(5)`, they are ordinary names, so older programs keep working. Every
other keyword spelling is reserved.

`blockStyle: 'braces'` replaces `END X` with `{ … }` after a header (AP CSP: `IF (x > 3) { … } ELSE { … }`,
`REPEAT 3 TIMES { … }`, `PROCEDURE p(a) { … }`); `'both'` accepts either.

Semantics: `=`/`≠` compare a number with text that looks like that number as equal (`"1" = 1`, so `INPUT choice` …
`choice = "1"` works although numeric-looking input becomes a number); items inside lists compare strictly, and
`< > <= >=` between a number and text are an error whose hint says to drop the quote marks. Text functions, `[ ]` and
FOR EACH count an emoji as one character (a per-run `TextIndex` in `values.ts` remembers the characters of the last few
texts and works out the length of joined text, so `FOR i … s[i]` loops and text built up a character at a time stay
linear). `/` true division, `DIV`/`MOD` floor-based (Python-like); division by zero is an error; numbers print
without trailing `.0` and with float noise removed (`0.1 + 0.2` → `0.3`); booleans print as the teacher's TRUE/FALSE
spelling; lists print as `[1, 2, 3]` (strings inside lists quoted). Functions/procedures are hoisted; lookups go
local → global; assignment updates an existing local, else an existing global, else creates a local.
Step limit (default 5,000,000) and call-depth limit give friendly "never-ending loop" / "too much recursion" errors;
a list may hold at most 10,000,000 items (`l ← l + l` would otherwise exhaust memory within the step limit). Text that
grows too long and lists nested too deeply to print are reported at the statement that was running.

**Constructs switched off ("not learned yet")** are still recognised, so students get
`You haven't learned "WHILE" yet.` instead of a confusing parse error. Built-ins can be renamed or switched off.

Comment symbols come from a fixed list, `COMMENT_PREFIXES`: `//` `#` `--` `%` `;`. The lexer looks for comments before
operators, so other symbols could swallow code written without spaces (`!` starts `!=`, `((` starts `((1 + 2) * 3)`,
`*(` is in `2*(1+2)`), and `'` starts text. With `--`, `5--2` is `5` and a comment (write `5 - -2`); with `;`, a
semicolon no longer separates two instructions. `validatePseudocodeConfig` rejects any other symbol and
`normalizePseudocodeConfig` drops it from stored configs (falling back to `//` when none is left). Validation also
rejects two spellings of one keyword where one starts with the other and the extra word could be a name (`PRINT` and
`PRINT LINE` would read `PRINT line` as one word) or a keyword that could follow the shorter one (`IF` / `IF NOT` would
drop the NOT; `END` / `END LOOP` when LOOP closes a WHILE); harmless pairs are allowed (`END` / `END IF`, and `REPEAT` /
`REPEAT UNTIL` or `ELSE` / `ELSE IF`, which the parser reads like the two words). Keyword slots added later (`declare`,
`constant`) are optional in the schema and filled with their defaults.

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
- **Student registration** (`POST /api/auth/register`): a class code and/or an invited email. A code must belong to a
  class that is join-enabled and not archived (else 400 `fieldErrors.joinCode`); an email used by another account →
  409 `fieldErrors.email`; without a code the email needs a pending invite in a non-archived class (else 400
  `fieldErrors.email`); username taken → 409 `fieldErrors.username`. Creates the student (storing the email), enrolls
  via the code and `claimInvites` in one transaction, signs in, and returns `joinedClasses`. `GET /api/join/:code` is
  a public preview (404 when unknown). Unknown class codes on the preview, registration and `POST /classes/join`, and
  uninvited emails on registration, share a per-IP budget of 60 misses / 10 min → 429 (matches don't count).
- **Change password** verifies the current one (400 `fieldErrors.currentPassword`), clears `must_change_password`,
  and ends the user's other sessions. **Profile**: name + optional email (unique → 409 `fieldErrors.email`); a student
  whose email changes claims that email's invites (`joinedClasses`).
- **Users admin** (admin only): list with `classCount` (classes owned for staff, enrolled for students), create
  (temporary password via `generateTemporaryPassword()`, `must_change_password = 1`), edit (no self role change;
  at least one admin must remain), reset password (ends their sessions; not for yourself), delete (not yourself;
  409 for teachers who still own classes). Creating a student with an email, or giving a student (or an account that
  becomes one) a new email, claims that email's invites.
- UI: `SetupPage` (redirect to /login when not needed), `LoginPage` (redirect to /setup when needed; honours
  `?next=`; link to /join), `JoinPage` (/join and /join/:code — signed out: code + live class preview, then create
  account with an optional "School email" that also joins classes that invited it; or "My teacher added my email
  instead" (opened directly by `/join?email=1`, ignored when the link has a code) → account step without a code and a
  required email; `validateJoinAccount` in `formValidation.ts` (the refined `registerSchema` can't be `.omit()`ed);
  `joinCode`/`email` field errors inline; afterwards a notice naming `joinedClasses` (`joinedClasses.ts`) and
  navigation into the class when exactly one was joined, else /dashboard; signed-in student: join directly (with
  `?email=1`, a hint to add the email on the account page); staff: explain they can't join), `AccountPage` (profile,
  password, temp-password alert; saving an email that returns `joinedClasses` shows a notice naming them and
  `useUpdateProfile` refreshes classes + dashboard), `UsersPage` (tabs by role, table, create/edit/reset/delete, one-time temporary password modal
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
- Invitations by email (`server/src/routes/invites.ts`, table `class_invites`, staff of the class): `GET` lists pending
  invites first (newest first), then joined ones (latest join first) with who joined. `POST` imports
  `importInvitesSchema` entries: each email is checked with `z.email()` and lowercased, repeats in the list are
  `duplicate`; an existing student account (case-insensitive) is enrolled now and its invite stored as joined (audit
  trail), staff emails are `not_a_student`, other emails become pending invites; `already_enrolled` /
  `already_invited` change nothing; `dryRun` returns the same rows and counts without writing (it names the matching
  student account only to admins or to staff who teach that student). Importing into an archived class → 409.
  `DELETE` removes one
  invite of that class (404 otherwise; a joined student stays enrolled). `claimInvites(userId, email)`
  (`server/src/invites.ts`, students only) enrolls in every non-archived class with a pending invite for the email
  (join-enabled not required) and marks those invites joined (`claimed_by`, `claimed_at`). An invite counts as open
  (`INVITE_OPEN_SQL`) while unclaimed, or once the account that claimed it is deleted or no longer has that email, so
  the address can be claimed again. There is no email verification, so anyone who knows an invited address can claim
  it; the invite list shows which account joined and when.
- Dashboards (`GET /api/dashboard`): staff → stats (classes, distinct students, to-grade = status submitted,
  late/missing = (student, published assignment) pairs where `isLate`), `toGrade` (10 oldest submitted),
  `upcoming` (published, due in the next 14 days, soonest first, max 8), `classes` (non-archived). Student →
  stats (classes, due within 7 days & not submitted, late, graded), classes, all published assignments in enrolled
  non-archived classes (not-submitted first by due date with no-due last, then submitted, then graded).
- UI: `TeacherClassesPage` (Active/Archived, link-card grid, first-run empty state, `CreateClassModal` exported from
  `pages/classes/CreateClassModal.tsx` for reuse; it requires at least one language), `TeacherClassPage` (header with big join-code chip + copy,
  "New assignment"; tabs Assignments | Students | Settings: assignment table with progress/late/to-grade/draft and
  "Copy from another class" (`CopyAssignmentsModal`: source Select of active, then archived classes, this class last;
  checklist with select all; "Keep due dates" / "Publish straight away" switches, both off; warnings for languages
  the copy adds to the class or that are turned off (`copyAssignments.ts`); a summary notification, and skipped
  assignments stay listed with their reasons in the dialog),
  roster with add/reset/remove + shareable join link `${origin}/join/${code}`; "Import from spreadsheet"
  (`ImportStudentsModal`: FileDropzone for .csv/.txt/.tsv up to 1 MB or a pasted list, parsed in the browser by
  `csv.ts` — hand-written RFC 4180 parser, `,`/`;`/tab detection, BOM, UTF-16/Windows-1252 decoding, header and
  email/name column detection, plain "Name <email>" / "name, email" lists — then a dry run preview with
  `InviteOutcomeBadge` per row and totals (`importSummary.ts`), then the import and a "4 added now, 18 will join when
  they sign up" notification); `InvitesCard` below the roster (only when the class has invites: waiting / joined
  views, remove a pending invite with a confirm, joined rows show the account and when, "Copy sign-up link"
  `${origin}/join?email=1`, the no-verification trade-off in one sentence), settings form for name/description/
  languages/join-enabled, regenerate code, archive, delete), `TeacherDashboard` (StatCards, needs-grading list,
  due-soon list with progress, classes grid, first-run empty state).

### 7.3 Assignments, submissions, grading
- Assignment language must be one of the class's languages (400 `fieldErrors.languageId`); an existing assignment may
  keep a language that was later disabled. Kinds that don't support tests (`web`) must have no tests. Test ids unique.
  `PATCH` can't lower `points` below an existing grade (400 `fieldErrors.points`); grades are never rescaled.
- Solutions: `solutionCode` + `solutionVisibility` (`assignments.solution_code`/`solution_visibility`, defaults `''` /
  `'hidden'`; `migrate()` adds both columns to older databases). `after_due` needs a due date, checked against the saved
  values merged with the PATCH, so clearing the due date of an `after_due` assignment is rejected too (400
  `fieldErrors.solutionVisibility`). Staff always get `solutionCode`; students get it only when `solutionReleased`
  (`shared/src/solutions.ts`, the only place the rules live) allows it for their own submission status, else null —
  `toAssignment` requires the student's submission and throws without it. `hasSolution` = code isn't blank. Release is
  decided on each read: work returned for revision hides an `after_graded` / `after_due` solution again until it's
  graded / handed in. Only `GET/POST/PATCH /assignments…` (`assignmentResponse`) and the teacher's grading detail
  return an `Assignment`; the student submission endpoints return just the submission.
- `GET /classes/:id/assignments` order: due date ascending (no due date last), then newest. Staff rows carry class
  counts; student rows carry `myStatus/myLate/myGrade` and only published assignments.
- Copy (`POST /classes/:id/assignments/copy`, `copyAssignmentsSchema`): the caller must manage class :id (403/404 like
  create) and every source's class (archived included); an unknown source or another teacher's → 404 and nothing is
  copied (one transaction). Copies are made in `assignmentIds` order (a repeated id copies once) with fresh
  timestamps, test ids kept and no submissions; `published` = `publish`; `due_at` only with `keepDueDates`, and an
  `after_due` solution without a due date becomes `hidden` (a `notes` entry when the solution isn't blank). Like
  create, a copy needs an installed, enabled language: a missing one is added to `class_languages`
  (`addedLanguageIds`, class `updated_at` bumped), a disabled or uninstalled one is `skipped` with a reason — even
  when the class already has it. Same-class copies get " (copy)" (title cut to stay ≤ 120). Always 201.
- Student work: `GET/PUT /assignments/:id/submission` (PUT 409 when submitted — "Unsubmit to keep editing" — or
  graded), `POST /submit` (409 when graded, or past due with `allowLate` false unless the work was returned; stores
  visible-test results and `autoScore = computeAutoScore(visibleTests, results)`, which weights tests by points —
  0-point tests don't count, and if every test is 0 points they count equally), `POST /unsubmit` (only from
  submitted; clears `submitted_at`). Staff calling the student endpoints → 403.
- Teacher: `GET /assignments/:id/submissions` (one row per enrolled student, name order),
  `GET …/submissions/:studentId` (enrolled students only; prev/next in name order), `PATCH …/submissions/:studentId`
  (creates the row from starter code if needed; a non-null `grade` without `status` ⇒ graded with `graded_at`,
  `graded_by`; `status: 'in_progress'` returns work for revision keeping feedback and `submitted_at`, and sets
  `returned_at`/`returnedAt` when the work was submitted or graded; `status: 'submitted'` clears it when undoing a
  return (from in progress) and keeps it when taking a grade off; a PATCH with only `testResults/autoScore` leaves
  status unchanged). `autoGraded` with a non-null grade marks it set by autograde (`submissions.auto_graded`, added by
  `migrate()`; any other grade is a hand grade, and no grade ⇒ false). `expectedUpdatedAt` (null = no row yet) must
  equal the row's `updated_at` or the PATCH is refused with 409 and nothing is written, so grading never lands on
  work that changed since it was looked at (unsubmitted, handed in again). Every write to a submission moves
  `updated_at` forward by at least 1 ms (`nextUpdatedAt`) so that check can't miss a change. Returned work can be submitted after the due date even with
  `allowLate` false, and `isLate` is false while `returned_at` is set (also after it is handed in again and graded).
  `db.ts` `migrate()` adds `returned_at` to older databases (marking in-progress rows with feedback as returned).
- UI: `AssignmentEditorPage` (new + edit: details card with Markdown instructions write/preview, language from class
  languages, points, due date `DateTimePicker`, allow late, publish/draft; starter code `CodeEditor`; Solution card
  (`SolutionEditor`: solution `CodeEditor` with "Copy starter code" while it's empty; "Who can see it" radio cards
  (`.modeCard`) from `SOLUTION_VISIBILITY_LABELS`, "After the due date" disabled without a due date, and clearing the
  due date switches it to "Teachers only" with a notice (setting one again switches it back); client validation and
  the server's `fieldErrors.solutionVisibility` show under the cards; for kinds with tests "Check solution" runs it
  against every test incl. hidden via `runTests` with the compare mode and lists the failing ones); tests editor with
  compare mode, hidden/points per test, and "Fill expected output from a model solution" which starts from the
  solution (else the starter code), runs it against each input via `runTests`/`startRun` and can keep the code it ran
  as the solution; "Preview as student" in a full-screen modal `CodeWorkspace` showing the solution, or its pending
  note, as a student who hasn't started would see it now (`solutionView.ts`); sticky save bar; `useBlocker` for
  unsaved changes; `editorForm.ts` maps form ⇄ API, solution fields included), `AssignmentOverviewPage` (teacher view
  of `/assignments/:id`: header with language/draft/due badges and `SolutionBadge` (who can see it, description in a
  tooltip) when there is a solution, Edit + Preview + "Autograde", stat tiles, instructions accordion, students table
  filterable All / To grade / Missing with a "Matches solution" badge on handed-in work whose code `matchesSolution`
  and an inline `GradeCell` per row), `GradingPage` (read-only `CodeWorkspace` with all tests incl. hidden and the
  solution; side card with status, late, code matches solution, auto score (`autoScoreView.ts`), "Use auto-score"
  (`gradeFromAutoScore`), grade `NumberInput` out of points (says when autograde set it; saving makes it a hand
  grade), feedback, Save grade, Return for revision, prev/next student).
- Autograde (`autograde.ts` pure logic, `useAutograde.tsx` runs it, `AutogradeModal.tsx`): offered when the kind
  supports tests and there are tests, or there is a solution (`autogradeMethod`). The modal explains the rules for
  this assignment and picks the work — waiting to be graded / all handed-in work (default; regrades autograde's own
  grades, keeps hand grades) / all handed-in work replacing every grade — and "Set grades from the scores" (off =
  only refresh results and auto scores). One submission at a time in this browser (fresh worker, abortable, one
  updating notification). Score: code that `matchesSolution` ⇒ 100 (tests still run and are stored); else the
  weighted share of every test incl. hidden; with no tests the solution runs once without input and work that
  finishes `ok` printing the same (`outputsMatch`, compare mode) without reading input ⇒ 100, anything else no score
  — unless the solution itself can't give a reference (needs input, errors, prints nothing), when only exact matches
  score. A grade = `gradeFromAutoScore`, saved with `status: 'graded', autoGraded: true` only for work the scope may
  (re)grade; a regrade that can no longer score autograde's own grade sets it back to submitted; a runner failure
  leaves the work untouched. Every PATCH sends `expectedUpdatedAt`; a 409 counts as "changed while autograding".
  The summary counts graded / left for you / hand grades kept / grades taken off / changed / couldn't check / failed.
- `GradeCell`: `NumberInput` (0..points, 1 decimal, strict clamp, no arrow-key stepping) + "/ points" + an "Auto"
  badge for autograded grades. Saves on blur or Enter when changed (Enter / ↑ / ↓ move between rows), Escape or an
  empty box restores the saved grade; PATCH `{ grade, status: 'graded', expectedUpdatedAt }` with the `updatedAt`
  seen when editing began (409 ⇒ warning + refetch). Work that wasn't handed in can be graded too (e.g. 0 for missing
  work; the input's description says it stops the student editing). Rows edited on a filtered tab stay listed until
  the tab changes (`inlineGrade.ts`).

### 7.4 Student experience & playground
- `StudentDashboard` (StatCards, "To do" list, recently graded, join-class modal; first-run empty state asking for a
  class code), `StudentClassesPage` (class cards + join), `StudentClassPage` (assignment rows with language, due,
  status, late, grade), `StudentAssignmentPage` (compact header + `CodeWorkspace` with instructions, visible tests,
  word bank; autosave debounced ~1.5 s with "Saving… / Saved just now / Couldn't save — retry" status, flush on
  unmount and `beforeunload`; Submit runs the visible tests first and shows a summary in a confirm modal; submitted ⇒
  read-only + Unsubmit; graded ⇒ read-only with grade + feedback banner; returned (in progress with `returnedAt`) ⇒
  editable with a "Returned for revision" banner showing the feedback, never closed or late; closed when past due and
  late work not allowed; Solution tab with the server-released `solutionCode`, else `solutionPendingNote` for the
  current status, and the assignment is refetched whenever `solutionReleased` disagrees with what was loaded, e.g.
  after a grade or once the due date passes).
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
  resizable panels (Mantine `Splitter`): side panel tabs Instructions | Tests | Words (pseudocode only) | Solution,
  editor, and a console (stdout, stderr in red, system lines dimmed, echoed input, inline input field while waiting
  with an "End input" button / Ctrl+D for programs that read until end of input, runtime-loading notice, "Finished in
  0.2 s" footer, clickable error line → editor; renders only the last 2,000 output runs, with an "earlier output
  hidden" line). Stop (toolbar, and in the Tests tab while tests run) stops a program or a test run; a stopped test
  run shows what ran but isn't reported through `onTestResults`. The toolbar and the side tabs stay on one line
  (`useFitLevel`): the toolbar drops the shortcut hint, then shows Run tests as an icon, and only wraps as a last
  resort; the tabs become icon-only with tooltips. Kind `web`: `WebPreview` + console of `console.log`s instead; pages
  without scripts update as you type, pages with a `<script>` or `on…=` handler only on Run. Falls back to an "Input
  for your program" textarea when interactive input is unavailable. Stacks vertically on small screens. The Solution
  tab (`SolutionPanel`) appears when `solutionCode` is non-blank: a read-only `CodeEditor` in the workspace's language
  (grows with the code up to the panel's height), "Run solution" (same runner, Input box and interactive input as Run;
  disabled while anything runs, Stop while the solution runs; its error line highlights and links to the solution's
  editor, not the main one) and a copy button. For `web` it shows the solution in the preview, whose header then reads
  "Solution" with "Back to page". With only `solutionNote` the tab shows that note instead. The remembered side tab
  falls back to the first tab when the panel no longer has it (`resolveSideTab` in `ideUtils`).
- `WordBank`: constructs from `buildVocabulary` (learned first; locked greyed with a lock icon and "Not learned
  yet"), keyword chips, rendered examples, built-ins table.
- `WebPreview`: `iframe sandbox="allow-scripts allow-modals"` with `srcDoc` + injected console capture via
  `postMessage` (unique channel id; ignore other messages). `webPreviewDocument.ts` scans the page with a small HTML
  tokenizer (comments, attribute values and raw text such as script/style/title/noscript/iframe content are not
  markup) and places the capture script first in `<head>`, before any earlier `<script>`. `loopProtect.ts` adds a
  time-budget guard `(typeof __ccLoop!=='function'||__ccLoop(line))` to every `while`/`do…while`/`for(;;)` condition
  in inline scripts (not to script text in attribute values such as `srcdoc`, `on…=` handlers or `for…in/of`; a script
  its tokenizer can't read, i.e. half-typed code, is left as is): loops that keep the page busy for over 1 s throw "The
  loop on line N ran for more than 1 second…" into the page console. Only the time spent inside
  alert/confirm/prompt/print is taken off the budget, so a prompt loop works but one whose dialogs return at once
  is still stopped.

## 8. Security notes
- Sessions: random 32-byte token in an httpOnly SameSite=Lax cookie; only its SHA-256 is stored. Passwords: scrypt.
- CSRF: non-GET `/api` requests must carry `x-codeclass: 1`. Every request with a valid session (GET included) must
  also send `x-codeclass-token` = the readable `cc_csrf` cookie (SHA-256 of `csrf:` + session token, set with `sid`).
  Exempt: `GET/POST /setup`, `POST /auth/login|register`, `GET /join/:code`. A missing/wrong token → 403 with
  `error.code: 'csrf'`, re-setting the cookie if it was missing or stale; the client wrapper (`client/src/api/client.ts`)
  reads `document.cookie` on every request and retries once on that 403. Student code runs in Web Workers on our origin
  (also when a teacher autogrades or previews it): its requests carry the cookies, but workers can't read them.
- The runner worker script is served with its own CSP (`server/src/app.ts` for `/assets/worker-*.js`, a Vite plugin in
  dev): `default-src 'none'`, scripts from self + the Pyodide CDN (with eval/wasm), `connect-src 'self'` + the Pyodide
  CDN (no other hosts, so nothing can be sent elsewhere), `worker-src`/`child-src 'none'` (no nested workers). The
  policy is a constant (no request headers go into it). Same-origin `/api` calls from a worker fail the token check.
- Students never receive hidden tests or other students' data. Teachers only manage their own classes (admins all).
- Student code runs only in browsers: Web Workers (no DOM, network APIs replaced, terminated on stop/timeout and
  JavaScript workers after every run; see §5) and a sandboxed iframe without
  `allow-same-origin` for web pages. Teacher-written Markdown is sanitized with DOMPurify.
