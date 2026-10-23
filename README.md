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

## Installing on an Ubuntu server

The scripts in `deploy/` install, update and remove CodeClass on Ubuntu 22.04 or 24.04 (64-bit). They need `sudo`.

```bash
git clone https://github.com/Marquette-Catholic-High-School/coding.git
cd coding
sudo ./deploy/install.sh --domain codeclass.yourschool.org --email it@yourschool.org
```

Then open the site and create the admin account. The first person to visit sets it up, so do this straight away.

The installer:

- installs Node.js 24 (from NodeSource) and the Caddy web server if they are missing, plus git and build tools;
- creates a `codeclass` system user, builds the app as that user, then makes each release root-owned and read-only
  in `/opt/codeclass/releases/…`, with `/opt/codeclass/current` pointing at the running one;
- stores the database in `/var/lib/codeclass`, database backups in `/var/backups/codeclass` (root only) and the
  settings in `/etc/codeclass/codeclass.env`;
- runs the app as the hardened `codeclass` systemd service, listening only on `127.0.0.1:3000`;
- has Caddy serve the site with a free, auto-renewing HTTPS certificate from Let's Encrypt. The domain must already
  point at the server, with ports 80 and 443 reachable. If `ufw` is active, those ports are opened.

Ways to run the installer:

| Command | Use when |
|---|---|
| `install.sh --domain NAME [--email ADDR]` | The server has a public name. Recommended. |
| `install.sh --http` | Testing, or a trusted internal network with no public name. Plain HTTP on port 80. |
| `install.sh --no-proxy --port 8080` | You already run your own reverse proxy. The app listens on all interfaces. |

Without HTTPS, browsers won't let programs pause for typed input. Programs then read from an "Input for your program"
box instead, and sign-in cookies travel unencrypted. Use `--domain` whenever you can.

Other options are `--branch NAME`, `--repo URL`, `--port PORT` and `--yes` (no questions). See `install.sh --help`.
To change the domain, port or mode later, run the installer again with `--force` and the new options. It keeps all data,
reuses the earlier settings for anything you leave out, and keeps your own edits to `codeclass.env` such as
`DATABASE_PATH`. If the rebuild fails, the previous settings are put back.

### Updating

```bash
sudo codeclass-update            # build the newest commit of the branch and switch to it
sudo codeclass-update --check    # only report whether an update is available
sudo codeclass-update --rollback # switch back to the previous release
```

Run updates over SSH inside `tmux` or `screen`, so you can still see the output if the connection drops. (The update
carries on either way.) The new version builds while the old one keeps serving. The site is then offline for a few seconds while it switches
over. Before switching, the database is copied to `/var/backups/codeclass` (the newest 10 copies are kept). If the new
version doesn't start, or doesn't stay up, the updater puts the previous version and the database back by itself.
`--rollback` returns to the release that ran before the last switch (run it again to go forward). The newest 3 releases
are kept. `--branch NAME` switches to another branch and remembers it.

If your server was installed with the very first version of these scripts (commit `f8c2983`), upgrade it once by
running `sudo ./deploy/install.sh --force` from a fresh clone instead of `codeclass-update`. That moves it to the
current, root-owned layout. After that, `codeclass-update` works as described.

### Uninstalling

```bash
sudo codeclass-uninstall          # removes the app and service; keeps the database, backups and settings
sudo codeclass-uninstall --purge  # also deletes all data, backups, the settings and the codeclass user
```

Node.js and Caddy are left installed, because other software may use them. Installing again after an uninstall without
`--purge` picks up the kept database and settings.

### Running it

| Task | Command |
|---|---|
| Status / restart | `systemctl status codeclass` · `sudo systemctl restart codeclass` |
| Logs | `journalctl -u codeclass -f` (web server: `journalctl -u caddy`) |
| Settings | edit `/etc/codeclass/codeclass.env`, then restart |
| Back up | `sudo systemctl stop codeclass`, copy `/var/lib/codeclass/codeclass.db*` somewhere safe, then `sudo systemctl start codeclass`. Every update also leaves a copy in `/var/backups/codeclass` |
| Restore a backup | see below |

Settings in `codeclass.env`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the app listens on |
| `HOST` | every interface | `127.0.0.1` behind the reverse proxy |
| `DATABASE_PATH` | `data/codeclass.db` | SQLite database file |
| `COOKIE_SECURE` | unset | `1` when the site is served over HTTPS |

To restore a database backup (`X.db` is the backup file):

```bash
sudo systemctl stop codeclass
sudo rm -f /var/lib/codeclass/codeclass.db-wal /var/lib/codeclass/codeclass.db-shm
sudo install -o codeclass -g codeclass -m 0640 X.db /var/lib/codeclass/codeclass.db
# only if the backup has one: sudo install -o codeclass -g codeclass -m 0640 X.db-wal /var/lib/codeclass/codeclass.db-wal
sudo systemctl start codeclass
```

To run it by hand somewhere else, use `npm ci && npm run build && npm start`. Any reverse proxy you use must pass
through the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. Programs need them to pause for
typed input.

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
