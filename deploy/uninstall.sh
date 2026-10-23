#!/usr/bin/env bash
# CodeClass uninstaller (installed as /usr/local/sbin/codeclass-uninstall).
#
#   sudo codeclass-uninstall           # remove the app and service, KEEP the database, backups and settings
#   sudo codeclass-uninstall --purge   # remove everything, including all student work
#
# Node.js and Caddy stay installed (other software may use them); the script prints how to remove them.
set -Eeuo pipefail

APP_HOME=/opt/codeclass
DATA_DIR=/var/lib/codeclass
CONF_DIR=/etc/codeclass
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
  --purge      Also delete the database (all classes, accounts and student work), backups, settings and the
               codeclass user. Without it they are kept, so a later install picks up where you left off.
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
if [[ ! -e "$CONF_DIR/install.conf" && ! -e "$APP_HOME" && ! -e "/etc/systemd/system/$SERVICE.service" && ! -e "$DATA_DIR" ]]; then
  ok "CodeClass is not installed; nothing to do"
  exit 0
fi

if [[ $ASSUME_YES -eq 0 ]]; then
  [[ -t 0 ]] || die "refusing to uninstall without confirmation; re-run with --yes"
  if [[ $PURGE -eq 1 ]]; then
    warn "--purge permanently deletes ALL CodeClass data: accounts, classes, assignments and student work,"
    warn "including the backups in $DATA_DIR/backups."
    read -r -p "Type DELETE to confirm: " answer
    [[ "$answer" == DELETE ]] || die "cancelled"
  else
    read -r -p "Remove CodeClass (the database, backups and settings are kept)? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || die "cancelled"
  fi
fi

step "Stopping the service"
if systemctl list-unit-files "$SERVICE.service" --no-legend 2>/dev/null | grep -q "$SERVICE.service"; then
  systemctl disable --now --quiet "$SERVICE" || true
fi
rm -f "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl reset-failed "$SERVICE" 2>/dev/null || true
ok "service removed"

if [[ $PURGE -eq 0 && -f "$DATA_DIR/codeclass.db" ]]; then
  # A final copy, taken while the service is stopped (the database file is complete).
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR/backups" 2>/dev/null || install -d -m 0750 "$DATA_DIR/backups"
  FINAL="$DATA_DIR/backups/codeclass-$(date -u +%Y%m%d-%H%M%S)-uninstall.db"
  cp -p "$DATA_DIR/codeclass.db" "$FINAL"
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
  if command -v caddy >/dev/null && systemctl is-active --quiet caddy; then
    systemctl reload caddy || warn "Caddy didn't reload; check 'systemctl status caddy'"
  fi
  ok "Caddy no longer serves CodeClass"
fi

step "Removing the program files"
rm -rf "${APP_HOME:?}/releases" "$APP_HOME/current" "$APP_HOME/current.new" "$APP_HOME/.npm" "$APP_HOME/.cache"
rmdir "$APP_HOME" 2>/dev/null || rm -rf "${APP_HOME:?}"
rm -f /usr/local/sbin/codeclass-update /run/codeclass-update.lock
ok "$APP_HOME and codeclass-update removed"

if [[ $PURGE -eq 1 ]]; then
  step "Deleting data, settings and the codeclass user"
  rm -rf "${DATA_DIR:?}" "${CONF_DIR:?}"
  if id -u "$APP_USER" >/dev/null 2>&1; then userdel "$APP_USER" 2>/dev/null || warn "couldn't delete user $APP_USER"; fi
  if getent group "$APP_USER" >/dev/null; then groupdel "$APP_USER" 2>/dev/null || true; fi
  rm -f /usr/local/sbin/codeclass-uninstall
  ok "everything removed"
else
  # Mark as not installed (so install.sh runs normally) but keep the settings for a reinstall.
  [[ -f "$CONF_DIR/install.conf" ]] && mv -f "$CONF_DIR/install.conf" "$CONF_DIR/install.conf.uninstalled"
fi

trap - ERR
step "${G}CodeClass is uninstalled${N}"
if [[ $PURGE -eq 0 ]]; then
  info "Kept: $DATA_DIR (database and backups), $CONF_DIR (settings) and the codeclass user."
  info "Reinstalling later reuses them. To delete them too: sudo codeclass-uninstall --purge"
fi
info "Node.js and Caddy are still installed. Remove them only if nothing else uses them:"
info "  sudo apt-get remove --purge nodejs caddy"
