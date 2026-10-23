#!/usr/bin/env bash
# CodeClass updater (installed as /usr/local/sbin/codeclass-update).
#
#   sudo codeclass-update              # update to the newest commit of the installed branch
#   sudo codeclass-update --check      # only say whether an update is available
#   sudo codeclass-update --rollback   # go back to the previous release
#
# The new version is built next to the running one, so the site stays up during the build. Then the service is
# stopped, the database is backed up, the new release is switched in and started. If it doesn't come up healthy, the
# previous release and the database backup are put back automatically.
set -Eeuo pipefail

APP_HOME=/opt/codeclass
DATA_DIR=/var/lib/codeclass
CONF_DIR=/etc/codeclass
SERVICE=codeclass
APP_USER=codeclass
KEEP_RELEASES=3
KEEP_BACKUPS=10

ASSUME_YES=0
CHECK_ONLY=0
ROLLBACK=0
FORCE=0
NO_BACKUP=0
NEW_BRANCH=""

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '%s    ✔ %s%s\n' "$G" "$*" "$N"; }
warn() { printf '%s    ! %s%s\n' "$Y" "$*" "$N" >&2; }
die() { printf '%sError: %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

usage() {
  cat <<EOF
Update CodeClass to the newest version of its branch.

Usage: sudo codeclass-update [options]
  --check          Only report whether an update is available.
  --branch NAME    Switch to (and remember) another branch.
  --force          Rebuild and restart even if already up to date.
  --rollback       Switch back to the previous release (the database is left as it is).
  --no-backup      Skip the database backup (not recommended).
  --yes            Don't ask for confirmation.
  -h, --help       Show this help.
Backups go to $DATA_DIR/backups (the newest $KEEP_BACKUPS are kept); the newest $KEEP_RELEASES releases are kept.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --branch) NEW_BRANCH="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --no-backup) NO_BACKUP=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

trap 'die "failed on line $LINENO (exit $?)"' ERR
[[ $EUID -eq 0 ]] || die "run this as root, e.g. sudo codeclass-update"
[[ -f "$CONF_DIR/install.conf" ]] || die "CodeClass doesn't look installed ($CONF_DIR/install.conf is missing). Run deploy/install.sh first."
exec 9>/run/codeclass-update.lock
flock -n 9 || die "another codeclass-update is already running"
# shellcheck disable=SC1091
. "$CONF_DIR/install.conf"
: "${REPO:?}" "${BRANCH:?}" "${PORT:?}" "${NODE_BIN:?}"
if [[ -n "$NEW_BRANCH" ]]; then
  [[ "$NEW_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch has unexpected characters"
  BRANCH="$NEW_BRANCH"
fi
[[ -x "$NODE_BIN" ]] || die "Node.js is missing at $NODE_BIN (recorded at install time)"
NODE_DIR="$(dirname "$NODE_BIN")"

SOURCE="$REPO"
GIT=(git)
if [[ -d "$REPO" ]]; then
  SOURCE="file://$(cd "$REPO" && pwd)"
  GIT=(git -c "safe.directory=*")
fi

confirm() {
  [[ $ASSUME_YES -eq 1 ]] && return 0
  [[ -t 0 ]] || die "$1 Re-run with --yes to confirm without a prompt."
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]]
}

as_app() { runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" "$@"; }

health() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# Release directories are named <UTC stamp>-<commit>, so sorting by name is sorting by age.
releases() { find "$APP_HOME/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort; }
current_release() { basename "$(readlink -f "$APP_HOME/current")"; }
release_sha() { echo "${1##*-}"; }

switch_to() {
  ln -sfn "$APP_HOME/releases/$1" "$APP_HOME/current.new"
  mv -T "$APP_HOME/current.new" "$APP_HOME/current"
}

render_unit() {
  sed -e "s#@NODE@#$NODE_BIN#g" -e "s#@APP_HOME@#$APP_HOME#g" -e "s#@DATA_DIR@#$DATA_DIR#g" \
    "$APP_HOME/releases/$1/deploy/codeclass.service" >"/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
}

DB="$DATA_DIR/codeclass.db"
BACKUP=""
backup_db() {
  [[ $NO_BACKUP -eq 1 ]] && { warn "skipping the database backup (--no-backup)"; return 0; }
  [[ -f "$DB" ]] || { info "no database yet, nothing to back up"; return 0; }
  BACKUP="$DATA_DIR/backups/codeclass-$(date -u +%Y%m%d-%H%M%S)-$1.db"
  # The service is stopped, so the WAL has been checkpointed; copy any leftovers too, to be safe.
  cp -p "$DB" "$BACKUP"
  for ext in -wal -shm; do [[ -f "$DB$ext" ]] && cp -p "$DB$ext" "$BACKUP$ext"; done
  chown "$APP_USER:$APP_USER" "$BACKUP"*
  chmod 0640 "$BACKUP"*
  ok "database backed up to $BACKUP"
  # Keep the newest backups only.
  find "$DATA_DIR/backups" -maxdepth 1 -name 'codeclass-*.db' -printf '%f\n' | sort | head -n "-$KEEP_BACKUPS" |
    while read -r old; do rm -f "$DATA_DIR/backups/$old" "$DATA_DIR/backups/$old-wal" "$DATA_DIR/backups/$old-shm"; done
}

restore_db() {
  [[ -n "$BACKUP" && -f "$BACKUP" ]] || return 0
  rm -f "$DB-wal" "$DB-shm"
  cp -p "$BACKUP" "$DB"
  for ext in -wal -shm; do [[ -f "$BACKUP$ext" ]] && cp -p "$BACKUP$ext" "$DB$ext"; done
  chown "$APP_USER:$APP_USER" "$DB"*
  warn "database restored from $BACKUP"
}

# Stops the service, switches releases and starts it again; on failure puts the previous release (and database) back.
activate() {
  local target="$1" previous="$2"
  step "Switching to $target"
  systemctl stop "$SERVICE"
  backup_db "$(release_sha "$previous")"
  switch_to "$target"
  render_unit "$target"
  systemctl start "$SERVICE"
  if health; then
    ok "$target is running"
    return 0
  fi
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
  warn "$target did not start properly; going back to $previous"
  systemctl stop "$SERVICE" || true
  restore_db
  switch_to "$previous"
  render_unit "$previous"
  systemctl start "$SERVICE"
  if health; then
    die "update failed, $previous is running again (see the log above)"
  fi
  die "update failed AND the previous release did not start; check 'journalctl -u $SERVICE'"
}

install_commands() {
  # Replace (not overwrite in place) so a running copy of this script is not changed under its feet.
  local dir="$APP_HOME/releases/$1/deploy" name
  for name in update uninstall; do
    install -m 0755 "$dir/$name.sh" "/usr/local/sbin/.codeclass-$name.new"
    mv -f "/usr/local/sbin/.codeclass-$name.new" "/usr/local/sbin/codeclass-$name"
  done
}

prune_releases() {
  local current previous
  current="$(current_release)"
  previous="$1"
  releases | head -n "-$KEEP_RELEASES" | while read -r old; do
    [[ "$old" == "$current" || "$old" == "$previous" ]] && continue
    rm -rf "${APP_HOME:?}/releases/$old"
    info "removed old release $old"
  done
}

CURRENT="$(current_release)"
CURRENT_SHA="$(release_sha "$CURRENT")"

# --- rollback -----------------------------------------------------------------------------------------------------
if [[ $ROLLBACK -eq 1 ]]; then
  PREVIOUS="$(releases | grep -B1 -xF "$CURRENT" | head -n1)"
  [[ -n "$PREVIOUS" && "$PREVIOUS" != "$CURRENT" ]] || die "there is no older release to go back to"
  confirm "Go back from $CURRENT to $PREVIOUS?" || die "cancelled"
  trap 'die "rollback failed on line $LINENO"' ERR
  activate "$PREVIOUS" "$CURRENT"
  install_commands "$PREVIOUS"
  step "${G}Rolled back to $PREVIOUS${N}"
  info "The database was not changed (a backup from just now is in $DATA_DIR/backups)."
  exit 0
fi

# --- check for a new version --------------------------------------------------------------------------------------
step "Checking $REPO ($BRANCH)"
REMOTE_SHA="$("${GIT[@]}" ls-remote "$SOURCE" "refs/heads/$BRANCH" | awk '{print substr($1, 1, 10)}')"
[[ -n "$REMOTE_SHA" ]] || die "branch '$BRANCH' was not found in $REPO"
info "installed: $CURRENT_SHA   available: $REMOTE_SHA"
if [[ "$REMOTE_SHA" == "$CURRENT_SHA" && $FORCE -eq 0 ]]; then
  ok "CodeClass is up to date"
  exit 0
fi
if [[ $CHECK_ONLY -eq 1 ]]; then
  info "An update is available. Run: sudo codeclass-update"
  exit 0
fi
confirm "Update CodeClass from $CURRENT_SHA to $REMOTE_SHA? The site is offline for a few seconds while it restarts." ||
  die "cancelled"

# --- build the new release next to the running one -----------------------------------------------------------------
step "Building the new version (the site stays up meanwhile)"
WORK="$(mktemp -d)"
NEW=""
cleanup_failed_build() {
  rm -rf "$WORK"
  [[ -n "$NEW" && "$NEW" != "$(current_release)" ]] && rm -rf "${APP_HOME:?}/releases/$NEW"
}
trap 'cleanup_failed_build; die "build failed on line $LINENO; nothing was changed and the site is still running $CURRENT_SHA"' ERR
"${GIT[@]}" clone --quiet --depth 1 --branch "$BRANCH" "$SOURCE" "$WORK/src"
SHA="$(git -C "$WORK/src" rev-parse --short=10 HEAD)"
NEW="$(date -u +%Y%m%d-%H%M%S)-$SHA"
mv "$WORK/src" "$APP_HOME/releases/$NEW"
rm -rf "$WORK"
chown -R "$APP_USER:$APP_USER" "$APP_HOME/releases/$NEW"
(cd "$APP_HOME/releases/$NEW" && as_app npm ci --no-audit --no-fund --loglevel=error)
(cd "$APP_HOME/releases/$NEW" && as_app node -e "require('better-sqlite3')") 2>/dev/null ||
  (cd "$APP_HOME/releases/$NEW" && as_app npm rebuild better-sqlite3 --loglevel=error)
(cd "$APP_HOME/releases/$NEW" && as_app npm run build --silent)
[[ -f "$APP_HOME/releases/$NEW/client/dist/index.html" ]] || false
ok "built $NEW"
trap - ERR

# --- switch over --------------------------------------------------------------------------------------------------
trap 'die "update failed on line $LINENO"' ERR
activate "$NEW" "$CURRENT"
if [[ -n "$NEW_BRANCH" ]]; then
  sed -i "s#^BRANCH=.*#BRANCH=$(printf '%q' "$BRANCH")#" "$CONF_DIR/install.conf"
fi
install_commands "$NEW"
prune_releases "$CURRENT"
trap - ERR

step "${G}CodeClass updated to $SHA${N}"
info "Previous release: $CURRENT (go back with: sudo codeclass-update --rollback)"
[[ -n "$BACKUP" ]] && info "Database backup: $BACKUP"
exit 0
