#!/usr/bin/env bash
# CodeClass updater (installed as /usr/local/sbin/codeclass-update).
# DEPLOY_API=2   (install.sh checks this marker before handing release handling to this script)
#
#   sudo codeclass-update              # update to the newest commit of the installed branch
#   sudo codeclass-update --check      # only say whether an update is available
#   sudo codeclass-update --rollback   # go back to the release that ran before the last switch
#
# The new version is built next to the running one, so the site stays up during the build. Then the service is
# stopped, the database is backed up, the new release is switched in and started. If it doesn't stay healthy, the
# previous release and the database backup are put back automatically.
#
# Security model: releases are built by the unprivileged `codeclass` user in a staging folder and then made root-owned
# and read-only. Root never reads or runs anything from a release folder: the systemd unit template and these admin
# commands are taken from root's own git clone and kept in root-only places.
set -Eeuo pipefail
umask 022

APP_HOME=/opt/codeclass
RELEASES="$APP_HOME/releases"
DATA_DIR=/var/lib/codeclass
BACKUP_DIR=/var/backups/codeclass
CONF_DIR=/etc/codeclass
UNIT_DIR="$CONF_DIR/units"
ENV_FILE="$CONF_DIR/codeclass.env"
SERVICE=codeclass
APP_USER=codeclass
KEEP_RELEASES=3
KEEP_BACKUPS=10
RELEASE_RE='^[0-9]{8}-[0-9]{6}-[0-9a-f]{7,40}$'

ASSUME_YES=0
CHECK_ONLY=0
ROLLBACK=0
FORCE=0
NO_BACKUP=0
FIRST_INSTALL=0
NEW_BRANCH=""

# Output never fails the script: after an SSH disconnect the terminal is gone, and a failed write must not abort a
# switch half-way. Run long updates inside tmux or screen to keep seeing the output.
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N" 2>/dev/null || true; }
info() { printf '    %s\n' "$*" 2>/dev/null || true; }
ok() { printf '%s    ✔ %s%s\n' "$G" "$*" "$N" 2>/dev/null || true; }
warn() { printf '%s    ! %s%s\n' "$Y" "$*" "$N" >&2 2>/dev/null || true; }
die() {
  printf '%sError: %s%s\n' "$R" "$*" "$N" >&2 2>/dev/null || true
  exit 1
}
trap 'die "failed on line $LINENO (exit $?)"' ERR

usage() {
  cat <<EOF
Update CodeClass to the newest version of its branch.

Usage: sudo codeclass-update [options]
  --check          Only report whether an update is available.
  --branch NAME    Switch to (and remember) another branch.
  --force          Rebuild and restart even if already up to date.
  --rollback       Switch back to the release that ran before the last update (the database is left as it is).
  --no-backup      Skip the database backup (not recommended).
  --yes            Don't ask for confirmation.
  -h, --help       Show this help.
Database backups go to $BACKUP_DIR (the newest $KEEP_BACKUPS are kept); the newest $KEEP_RELEASES releases are kept.
EOF
}

need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 needs a value"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --branch) need_value "$@"; NEW_BRANCH="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --install) FIRST_INSTALL=1; shift ;; # used by install.sh for the first release
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "run this as root, e.g. sudo codeclass-update"
[[ -f "$CONF_DIR/install.conf" ]] || die "CodeClass doesn't look installed ($CONF_DIR/install.conf is missing). Run deploy/install.sh first."
exec 9>/run/codeclass-update.lock
flock -n 9 || die "another codeclass-update is already running"

# install.conf is root-owned and written by install.sh with printf %q.
# shellcheck disable=SC1091
. "$CONF_DIR/install.conf"
: "${REPO:?install.conf has no REPO}" "${BRANCH:?install.conf has no BRANCH}" "${NODE_BIN:?install.conf has no NODE_BIN}"
if [[ -n "$NEW_BRANCH" ]]; then
  [[ "$NEW_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch has unexpected characters"
  BRANCH="$NEW_BRANCH"
fi
[[ -x "$NODE_BIN" ]] || die "Node.js is missing at $NODE_BIN (recorded at install time)"
NODE_DIR="$(dirname "$NODE_BIN")"

# Live settings come from codeclass.env (admins may edit it), not from the values used at install time.
env_get() {
  local value
  value="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value:-$2}"
}
PORT="$(env_get PORT 3000)"
DB="$(env_get DATABASE_PATH "$DATA_DIR/codeclass.db")"
CHECK_HOST="$(env_get HOST 127.0.0.1)"
case "$CHECK_HOST" in 0.0.0.0 | "::" | "") CHECK_HOST=127.0.0.1 ;; esac
[[ "$CHECK_HOST" == *:* ]] && CHECK_HOST="[$CHECK_HOST]"
HEALTH_URL="http://$CHECK_HOST:$PORT/api/health"

SOURCE="$REPO"
GIT=(git)
if [[ -d "$REPO" ]]; then
  [[ "$REPO" == /* ]] || die "install.conf has a relative REPO ($REPO); change it to an absolute path"
  SOURCE="file://$REPO"
  GIT=(git -c "safe.directory=*")
fi

confirm() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  [[ -t 0 ]] || die "$1 Re-run with --yes to confirm without a prompt."
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]]
}

# --- releases -----------------------------------------------------------------------------------------------------
# Finished releases are named <UTC stamp>-<commit>, so name order is age order; builds in progress start with a dot.
releases() { find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | grep -E "$RELEASE_RE" | sort || true; }
current_release() {
  if [[ -L "$APP_HOME/current" ]]; then basename "$(readlink -f "$APP_HOME/current")"; fi
}
previous_release() {
  local cur prev=""
  cur="$(current_release)"
  if [[ -L "$APP_HOME/previous" ]]; then prev="$(basename "$(readlink -f "$APP_HOME/previous")")"; fi
  if [[ -n "$prev" && "$prev" != "$cur" && -d "$RELEASES/$prev" ]]; then
    echo "$prev"
  elif [[ -n "$cur" ]]; then
    releases | grep -B1 -xF "$cur" | grep -vxF "$cur" | head -n1 || true
  fi
}
release_sha() { echo "${1##*-}"; }

set_link() { # set_link current|previous RELEASE
  ln -sfn "$RELEASES/$2" "$APP_HOME/$1.new" && mv -T "$APP_HOME/$1.new" "$APP_HOME/$1"
}

# The unit template saved (root-only) when RELEASE was built; the newest saved one for older releases. With none at
# all (an install made by older scripts), the existing unit is kept as it is.
render_unit() {
  local unit="/etc/systemd/system/$SERVICE.service" template="$UNIT_DIR/$1.service"
  if [[ ! -f "$template" ]]; then
    template="$(find "$UNIT_DIR" -maxdepth 1 -type f -name '*.service' -printf '%f\n' 2>/dev/null | sort | tail -n1 || true)"
    if [[ -z "$template" ]]; then
      [[ -f "$unit" ]] || return 1
      systemctl daemon-reload
      return
    fi
    template="$UNIT_DIR/$template"
  fi
  sed -e "s#@NODE@#$NODE_BIN#g" -e "s#@APP_HOME@#$APP_HOME#g" -e "s#@DATA_DIR@#$DATA_DIR#g" "$template" >"$unit.new" || return 1
  mv -f "$unit.new" "$unit" || return 1
  systemctl daemon-reload
}

prune_releases() {
  local current previous old
  current="$(current_release)"
  previous="$(previous_release)"
  while read -r old; do
    [[ -z "$old" || "$old" == "$current" || "$old" == "$previous" ]] && continue
    rm -rf "${RELEASES:?}/$old"
    rm -f "$UNIT_DIR/$old.service"
    info "removed old release $old"
  done < <(releases | head -n "-$KEEP_RELEASES")
  # Leftovers of builds that were interrupted more than an hour ago.
  find "$RELEASES" -mindepth 1 -maxdepth 1 -name '.build-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
}

# Installs made by the first published scripts let the codeclass user own /opt/codeclass and its releases. Make the
# code root-owned again: keep only the running release (frozen read-only, its .git removed) and drop the others.
migrate_layout() {
  local cur dir name
  cur="$(current_release)"
  install -d -o root -g root -m 0755 "$APP_HOME" "$RELEASES"
  for dir in "$RELEASES"/*/; do
    [[ -d "$dir" ]] || continue
    name="$(basename "$dir")"
    [[ -n "$(find "$dir" ! -user root -print -quit 2>/dev/null)" ]] || continue
    if [[ "$name" == "$cur" ]]; then
      chown -R root:root "$dir"
      chmod -R go-w "$dir"
      rm -rf "${dir:?}/.git"
      info "made $name root-owned"
    else
      rm -rf "${RELEASES:?}/$name"
      info "removed $name (built by older scripts)"
    fi
  done
  rm -rf "$APP_HOME/.npm" "$APP_HOME/.cache"
  install -d -o root -g root -m 0700 "$UNIT_DIR"
  if [[ "$(getent passwd "$APP_USER" | cut -d: -f6)" == "$APP_HOME" ]]; then usermod -d "$DATA_DIR" "$APP_USER" || true; fi
}

# --- health -------------------------------------------------------------------------------------------------------
# Healthy = answers within a minute and is still up, without systemd having restarted it, a few seconds later.
healthy() {
  local up=0 restarts
  for _ in {1..60}; do
    if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      up=1
      break
    fi
    sleep 1
  done
  [[ $up -eq 1 ]] || return 1
  restarts="$(systemctl show -p NRestarts --value "$SERVICE")"
  sleep 5
  systemctl is-active --quiet "$SERVICE" &&
    [[ "$(systemctl show -p NRestarts --value "$SERVICE")" == "$restarts" ]] &&
    curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1
}

# --- database backups ---------------------------------------------------------------------------------------------
# Files in the data folder are read and written as the app user, so a symlink placed there can't make root read or
# overwrite other files. Backups live in a root-only folder. (9>&- keeps the update lock out of the app user's hands.)
BACKUP=""
check_space() {
  [[ $NO_BACKUP -eq 1 || ! -f "$DB" ]] && return 0
  install -d -o root -g root -m 0700 "$BACKUP_DIR"
  local need avail
  need="$({ du -cb "$DB" "$DB-wal" 2>/dev/null || true; } | tail -n1 | cut -f1)"
  avail="$(df --output=avail -B1 "$BACKUP_DIR" | tail -n1 | tr -d ' ')"
  if ((avail < ${need:-0} + 50 * 1024 * 1024)); then
    die "not enough free disk space in $BACKUP_DIR for a database backup; nothing was changed"
  fi
}

backup_db() { # backup_db LABEL; sets BACKUP. Returns non-zero on failure (also when called in an `if`).
  BACKUP=""
  if [[ $NO_BACKUP -eq 1 ]]; then
    warn "skipping the database backup (--no-backup)"
    return 0
  fi
  if [[ ! -e "$DB" ]]; then
    info "no database yet, nothing to back up"
    return 0
  fi
  if [[ ! -f "$DB" || -L "$DB" ]]; then
    warn "$DB is not a regular file"
    return 1
  fi
  install -d -o root -g root -m 0700 "$BACKUP_DIR" || return 1
  local file
  file="$BACKUP_DIR/codeclass-$(date -u +%Y%m%d-%H%M%S)-$1.db"
  runuser -u "$APP_USER" -- cat "$DB" 9>&- >"$file" || { rm -f "$file"; return 1; }
  if [[ -f "$DB-wal" && ! -L "$DB-wal" ]]; then
    runuser -u "$APP_USER" -- cat "$DB-wal" 9>&- >"$file-wal" || { rm -f "$file" "$file-wal"; return 1; }
  fi
  chmod 0600 "$file" || return 1
  BACKUP="$file"
  ok "database backed up to $BACKUP"
}

restore_db() {
  [[ -n "$BACKUP" && -f "$BACKUP" ]] || return 0
  # rm removes symlinks themselves; the app user then writes the files (umask 027 → 0640). The inner sh expands $1.
  rm -f "$DB" "$DB-wal" "$DB-shm" || return 1
  # shellcheck disable=SC2016
  runuser -u "$APP_USER" -- sh -c 'umask 027 && cat >"$1"' sh "$DB" <"$BACKUP" 9>&- || return 1
  if [[ -f "$BACKUP-wal" ]]; then
    # shellcheck disable=SC2016
    runuser -u "$APP_USER" -- sh -c 'umask 027 && cat >"$1"' sh "$DB-wal" <"$BACKUP-wal" 9>&- || return 1
  fi
  warn "database restored from $BACKUP"
}

prune_backups() {
  local old
  while read -r old; do
    [[ -z "$old" || "$BACKUP_DIR/$old" == "$BACKUP" ]] && continue
    rm -f "${BACKUP_DIR:?}/$old" "$BACKUP_DIR/$old-wal"
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'codeclass-*.db' -printf '%f\n' 2>/dev/null | sort | head -n "-$KEEP_BACKUPS")
}

# --- switching releases -------------------------------------------------------------------------------------------
# activate TARGET PREVIOUS DISCARD: stop the service, back up, switch to TARGET and start it. If TARGET doesn't stay
# healthy, put PREVIOUS (empty on a first install) and the database back. DISCARD=1 deletes a failed TARGET.
activate() {
  local target="$1" previous="$2" discard="$3"
  step "Switching to $target"
  check_space
  # A dropped SSH session or Ctrl-C must not stop the script half-way through the switch.
  trap '' HUP INT TERM
  systemctl stop "$SERVICE" 2>/dev/null || true
  if ! backup_db "$(release_sha "${previous:-$target}")"; then
    [[ -n "$previous" ]] && { systemctl start "$SERVICE" || true; }
    die "couldn't back up the database, so nothing was changed${previous:+ ($previous is running again)}"
  fi
  if set_link current "$target" && render_unit "$target" && systemctl start "$SERVICE" && healthy; then
    if [[ -n "$previous" ]]; then set_link previous "$previous"; fi
    systemctl enable --quiet "$SERVICE"
    trap - HUP INT TERM
    ok "$target is running"
    return 0
  fi

  journalctl -u "$SERVICE" -n 40 --no-pager >&2 2>/dev/null || true
  warn "$target did not start properly${previous:+; going back to $previous}"
  systemctl stop "$SERVICE" 2>/dev/null || true
  if restore_db; then
    [[ -n "$BACKUP" ]] && rm -f "$BACKUP" "$BACKUP-wal" # identical to the restored database
  else
    warn "couldn't restore the database from $BACKUP; restore it by hand (see README)"
  fi
  if [[ "$discard" == 1 ]]; then rm -rf "${RELEASES:?}/$target" "$UNIT_DIR/$target.service"; fi
  if [[ -z "$previous" ]]; then
    rm -f "$APP_HOME/current"
    systemctl disable --quiet "$SERVICE" 2>/dev/null || true
    trap - HUP INT TERM
    die "CodeClass didn't start (see the log above). Fix the problem and run the installer again, or remove it with: sudo codeclass-uninstall"
  fi
  if ! { set_link current "$previous" && render_unit "$previous" && systemctl start "$SERVICE"; }; then
    warn "couldn't switch back to $previous cleanly"
  fi
  trap - HUP INT TERM
  if healthy; then die "$target didn't start properly, so $previous is running again (see the log above)"; fi
  die "$target didn't start AND $previous didn't come back; check: journalctl -u $SERVICE"
}

# --- building -----------------------------------------------------------------------------------------------------
BUILD_WORK=""
BUILD_HOME=""
BUILD_STAGE=""
NEW=""
# Removes temporary build folders (and an unfinished staging folder). Runs on every exit.
# shellcheck disable=SC2317 # only called from the EXIT trap
cleanup_build() {
  if [[ -n "$BUILD_HOME" ]]; then rm -rf "$BUILD_HOME"; fi
  if [[ -n "$BUILD_STAGE" && -d "$BUILD_STAGE" ]]; then rm -rf "$BUILD_STAGE"; fi
  if [[ -n "$BUILD_WORK" ]]; then rm -rf "$BUILD_WORK"; fi
  return 0
}
trap cleanup_build EXIT

# Runs a command as the app user in a folder, with the recorded Node.js first in PATH and a throwaway npm cache.
as_app() {
  local dir="$1"
  shift
  runuser -u "$APP_USER" -- env -C "$dir" HOME="$BUILD_HOME" npm_config_cache="$BUILD_HOME/npm-cache" \
    PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" "$@" 9>&-
}

# better-sqlite3 ships prebuilt binaries for common machines; compile it when none fits.
sqlite_ok() {
  local dir="$1" probe="new (require('better-sqlite3'))(':memory:').close()" gyp
  as_app "$dir" node -e "$probe" 2>/dev/null && return 0
  warn "no prebuilt SQLite driver for this machine; compiling it (this takes a minute)"
  gyp="$(dirname "$(readlink -f "$NODE_DIR/npm")")/../node_modules/node-gyp/bin/node-gyp.js"
  [[ -f "$gyp" ]] || return 1
  as_app "$dir/node_modules/better-sqlite3" node "$gyp" rebuild --release >/dev/null || return 1
  as_app "$dir" node -e "$probe"
}

# Builds the newest commit of $BRANCH into $RELEASES/$NEW (root-owned, read-only) and keeps root's own copy of its
# deploy files in $BUILD_WORK/src/deploy. Runs under the ERR trap.
build_release() {
  BUILD_WORK="$(mktemp -d)"
  "${GIT[@]}" clone --quiet --depth 1 --branch "$BRANCH" "$SOURCE" "$BUILD_WORK/src"
  local sha
  sha="$(git -C "$BUILD_WORK/src" rev-parse --short=10 HEAD)"
  NEW="$(date -u +%Y%m%d-%H%M%S)-$sha"
  info "commit $sha"
  BUILD_STAGE="$RELEASES/.build-$NEW"
  cp -a "$BUILD_WORK/src" "$BUILD_STAGE"
  rm -rf "$BUILD_STAGE/.git" # never give the build a git repository root might later trust
  chown -R "$APP_USER:$APP_USER" "$BUILD_STAGE"
  BUILD_HOME="$(mktemp -d)"
  chown "$APP_USER:$APP_USER" "$BUILD_HOME"
  as_app "$BUILD_STAGE" npm ci --no-audit --no-fund --loglevel=error
  sqlite_ok "$BUILD_STAGE" || false
  as_app "$BUILD_STAGE" npm run build --silent
  [[ -f "$BUILD_STAGE/client/dist/index.html" ]] || false
  # Freeze the build: root-owned and read-only from here on.
  chown -R root:root "$BUILD_STAGE"
  chmod -R go-w "$BUILD_STAGE"
  mv -T "$BUILD_STAGE" "$RELEASES/$NEW"
  BUILD_STAGE=""
  install -m 0600 -o root -g root "$BUILD_WORK/src/deploy/codeclass.service" "$UNIT_DIR/$NEW.service"
  rm -rf "$BUILD_HOME"
  BUILD_HOME=""
  ok "built $NEW"
}

# The admin commands of the new release, from root's own clone. Replaced (not overwritten in place), so a running
# copy of this script is not changed under its feet.
install_commands() {
  local name
  for name in update uninstall; do
    install -m 0755 -o root -g root "$BUILD_WORK/src/deploy/$name.sh" "/usr/local/sbin/.codeclass-$name.new"
    mv -f "/usr/local/sbin/.codeclass-$name.new" "/usr/local/sbin/codeclass-$name"
  done
}

save_branch() {
  sed -i "s#^BRANCH=.*#BRANCH=$(printf '%q' "$BRANCH")#" "$CONF_DIR/install.conf"
  info "now following branch $BRANCH"
}

migrate_layout
CURRENT="$(current_release)"

# --- rollback -----------------------------------------------------------------------------------------------------
if [[ $ROLLBACK -eq 1 ]]; then
  [[ -n "$CURRENT" ]] || die "no release is installed"
  PREVIOUS="$(previous_release)"
  [[ -n "$PREVIOUS" ]] || die "there is no older release to go back to"
  confirm "Go back from $CURRENT to $PREVIOUS?" || die "cancelled"
  activate "$PREVIOUS" "$CURRENT" 0
  step "${G}Rolled back to $PREVIOUS${N}"
  info "The database was not changed (a backup from just now is in $BACKUP_DIR)."
  info "To return to $CURRENT: sudo codeclass-update --rollback"
  exit 0
fi

# --- check for a new version --------------------------------------------------------------------------------------
if [[ $FIRST_INSTALL -eq 1 ]]; then
  [[ -z "$CURRENT" ]] || die "a release is already installed; use codeclass-update"
else
  [[ -n "$CURRENT" ]] || die "no release is installed; run deploy/install.sh"
  step "Checking $REPO ($BRANCH)"
  REMOTE_SHA="$(
    trap - ERR
    "${GIT[@]}" ls-remote "$SOURCE" "refs/heads/$BRANCH" | awk '{print substr($1, 1, 10)}'
  )" || die "couldn't reach $REPO"
  [[ -n "$REMOTE_SHA" ]] || die "branch '$BRANCH' was not found in $REPO"
  CURRENT_SHA="$(release_sha "$CURRENT")"
  info "installed: $CURRENT_SHA   available: $REMOTE_SHA"
  if [[ "$REMOTE_SHA" == "$CURRENT_SHA" && $FORCE -eq 0 ]]; then
    if [[ -n "$NEW_BRANCH" && $CHECK_ONLY -eq 0 ]]; then save_branch; fi
    ok "CodeClass is up to date"
    exit 0
  fi
  if [[ $CHECK_ONLY -eq 1 ]]; then
    info "An update is available. Run: sudo codeclass-update"
    exit 0
  fi
  confirm "Update CodeClass from $CURRENT_SHA to $REMOTE_SHA? The site is offline for a few seconds while it restarts." ||
    die "cancelled"
fi

# --- build next to the running release, then switch ---------------------------------------------------------------
step "Building CodeClass${CURRENT:+ (the site stays up meanwhile)}"
trap 'die "build failed on line $LINENO, so nothing was changed${CURRENT:+ and the site still runs $CURRENT}"' ERR
trap 'die "interrupted; nothing was changed"' HUP INT TERM
build_release
trap 'die "failed on line $LINENO (exit $?)"' ERR
trap - HUP INT TERM

activate "$NEW" "$CURRENT" 1
install_commands
if [[ -n "$NEW_BRANCH" ]]; then save_branch; fi
prune_backups
prune_releases

step "${G}CodeClass is now running $(release_sha "$NEW")${N}"
if [[ -n "$CURRENT" ]]; then info "Previous release: $CURRENT (go back with: sudo codeclass-update --rollback)"; fi
if [[ -n "$BACKUP" ]]; then info "Database backup: $BACKUP"; fi
exit 0
