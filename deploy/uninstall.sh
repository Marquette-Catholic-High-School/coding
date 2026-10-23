#!/usr/bin/env bash
# CodeClass uninstaller (installed as /usr/local/sbin/codeclass-uninstall).
#
#   sudo codeclass-uninstall           # remove the app and service, KEEP the database, backups and settings
#   sudo codeclass-uninstall --purge   # remove everything, including all student work
#
# Node.js and Caddy stay installed (other software may use them); the script prints how to remove them.
set -Eeuo pipefail
umask 022

APP_HOME=/opt/codeclass
DATA_DIR=/var/lib/codeclass
BACKUP_DIR=/var/backups/codeclass
CONF_DIR=/etc/codeclass
ENV_FILE="$CONF_DIR/codeclass.env"
SERVICE=codeclass
APP_USER=codeclass
CADDY_SITE=/etc/caddy/codeclass.caddy
CADDYFILE=/etc/caddy/Caddyfile

PURGE=0
ASSUME_YES=0

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '%s    ✔ %s%s\n' "$G" "$*" "$N"; }
warn() { printf '%s    ! %s%s\n' "$Y" "$*" "$N" >&2; }
die() { printf '%sError: %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
trap 'die "uninstall failed on line $LINENO (exit $?)"' ERR

usage() {
  cat <<EOF
Remove CodeClass from this server.

Usage: sudo codeclass-uninstall [options]
  --purge      Also delete the database (all classes, accounts and student work), the backups in $BACKUP_DIR,
               the settings and the codeclass user. Without it they are kept, so a later install carries on.
  --yes        Don't ask for confirmation.
  -h, --help   Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "run this as root, e.g. sudo codeclass-uninstall"
if [[ ! -e "$CONF_DIR" && ! -e "$APP_HOME" && ! -e "/etc/systemd/system/$SERVICE.service" && ! -e "$DATA_DIR" && ! -e "$BACKUP_DIR" ]]; then
  ok "CodeClass is not installed; nothing to do"
  exit 0
fi
exec 9>/run/codeclass-update.lock
flock -n 9 || die "codeclass-update is running; wait for it to finish"

DB="$(grep -E '^[[:space:]]*DATABASE_PATH=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
DB="${DB:-$DATA_DIR/codeclass.db}"

if [[ $ASSUME_YES -eq 0 ]]; then
  [[ -t 0 ]] || die "refusing to uninstall without confirmation; re-run with --yes"
  if [[ $PURGE -eq 1 ]]; then
    warn "--purge permanently deletes ALL CodeClass data: accounts, classes, assignments and student work,"
    warn "including the backups in $BACKUP_DIR."
    read -r -p "Type DELETE to confirm: " answer
    [[ "$answer" == DELETE ]] || die "cancelled"
  else
    read -r -p "Remove CodeClass (the database, backups and settings are kept)? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || die "cancelled"
  fi
fi

step "Stopping the service"
systemctl disable --now --quiet "$SERVICE" 2>/dev/null || true
rm -f "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl reset-failed "$SERVICE" 2>/dev/null || true
ok "service removed"

if [[ $PURGE -eq 0 && -f "$DB" && ! -L "$DB" ]]; then
  # A final copy, taken with the service stopped. Read as the app user, so a symlink in its folder can't redirect it.
  install -d -o root -g root -m 0700 "$BACKUP_DIR"
  FINAL="$BACKUP_DIR/codeclass-$(date -u +%Y%m%d-%H%M%S)-uninstall.db"
  runuser -u "$APP_USER" -- cat "$DB" >"$FINAL"
  if [[ -f "$DB-wal" && ! -L "$DB-wal" ]]; then runuser -u "$APP_USER" -- cat "$DB-wal" >"$FINAL-wal"; fi
  chmod 0600 "$FINAL"*
  ok "final database backup: $FINAL"
fi

if [[ -f "$CADDY_SITE" ]] || { [[ -f "$CADDYFILE" ]] && grep -qxF "import $CADDY_SITE" "$CADDYFILE"; }; then
  step "Removing the Caddy site"
  rm -f "$CADDY_SITE"
  if [[ -f "$CADDYFILE" ]]; then
    sed -i "\#^import $CADDY_SITE\$#d" "$CADDYFILE"
    # If nothing else is left in the Caddyfile, put back the stock one the installer replaced.
    if ! grep -qvE '^[[:space:]]*(#.*)?$' "$CADDYFILE" && [[ -f "$CADDYFILE.codeclass-original" ]]; then
      mv -f "$CADDYFILE.codeclass-original" "$CADDYFILE"
    fi
  fi
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy || warn "Caddy didn't reload; check 'systemctl status caddy'"
  fi
  ok "Caddy no longer serves CodeClass"
fi

step "Removing the program files"
rm -rf "${APP_HOME:?}"
rm -f /usr/local/sbin/codeclass-update
ok "$APP_HOME and codeclass-update removed"

if [[ $PURGE -eq 1 ]]; then
  step "Deleting data, backups, settings and the codeclass user"
  rm -rf "${DATA_DIR:?}" "${BACKUP_DIR:?}" "${CONF_DIR:?}"
  if [[ "$DB" != "$DATA_DIR"/* ]]; then rm -f "$DB" "$DB-wal" "$DB-shm"; fi
  if id -u "$APP_USER" >/dev/null 2>&1; then userdel "$APP_USER" 2>/dev/null || warn "couldn't delete user $APP_USER"; fi
  if getent group "$APP_USER" >/dev/null; then groupdel "$APP_USER" 2>/dev/null || true; fi
  rm -f /usr/local/sbin/codeclass-uninstall
  ok "everything removed"
elif [[ -f "$CONF_DIR/install.conf" ]]; then
  # Mark as not installed (so install.sh runs normally) but keep the settings for a reinstall.
  mv -f "$CONF_DIR/install.conf" "$CONF_DIR/install.conf.uninstalled"
fi

trap - ERR
step "${G}CodeClass is uninstalled${N}"
if [[ $PURGE -eq 0 ]]; then
  info "Kept: $DATA_DIR (database), $BACKUP_DIR (backups), $CONF_DIR (settings) and the codeclass user."
  info "Installing again reuses them. To delete them too: sudo codeclass-uninstall --purge"
fi
info "Node.js and Caddy are still installed. Remove them only if nothing else uses them:"
info "  sudo apt-get remove --purge nodejs caddy"
