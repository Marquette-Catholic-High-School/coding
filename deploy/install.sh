#!/usr/bin/env bash
# CodeClass installer for Ubuntu (22.04 / 24.04 or newer).
#
#   sudo ./deploy/install.sh --domain codeclass.yourschool.org --email it@yourschool.org
#   sudo ./deploy/install.sh --http          # plain HTTP on port 80 (testing / internal network)
#   sudo ./deploy/install.sh --no-proxy      # no web server; the app listens on --port itself
#
# Installs Node.js 24 (NodeSource) and Caddy (automatic HTTPS) if needed, creates a `codeclass` system user, builds the
# app from GitHub into /opt/codeclass, keeps data in /var/lib/codeclass and runs it as the `codeclass` systemd service.
# Afterwards use `sudo codeclass-update` and `sudo codeclass-uninstall`. Running it again with --force changes the
# settings (domain, port, …) and rebuilds, keeping all data.
set -Eeuo pipefail
umask 022

DEFAULT_REPO="https://github.com/Marquette-Catholic-High-School/coding.git"
APP_HOME=/opt/codeclass
DATA_DIR=/var/lib/codeclass
BACKUP_DIR=/var/backups/codeclass
CONF_DIR=/etc/codeclass
ENV_FILE="$CONF_DIR/codeclass.env"
APP_USER=codeclass
CADDYFILE=/etc/caddy/Caddyfile
CADDY_SITE=/etc/caddy/codeclass.caddy
NODE_MAJOR=24
MIN_NODE_MAJOR=22

REPO=""
BRANCH=""
DOMAIN=""
EMAIL=""
MODE="" # https | http | none
PORT=""
ASSUME_YES=0
FORCE=0

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
# Output never fails the script (after an SSH disconnect the terminal is gone).
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N" 2>/dev/null || true; }
info() { printf '    %s\n' "$*" 2>/dev/null || true; }
ok() { printf '%s    ✔ %s%s\n' "$G" "$*" "$N" 2>/dev/null || true; }
warn() { printf '%s    ! %s%s\n' "$Y" "$*" "$N" >&2 2>/dev/null || true; }
die() {
  printf '%sError: %s%s\n' "$R" "$*" "$N" >&2 2>/dev/null || true
  exit 1
}
REMOVE_HINT=""
trap 'die "install failed on line $LINENO (exit $?). Fix the problem and run the installer again${REMOVE_HINT}."' ERR

usage() {
  cat <<EOF
Install CodeClass on this Ubuntu server.

Usage: sudo $0 [options]

Choose how people reach the site (asked interactively if you pick none):
  --domain NAME    Public hostname, e.g. codeclass.school.org. Caddy gets a free HTTPS certificate from
                   Let's Encrypt. The name must already point at this server, with ports 80 and 443 open.
  --email ADDRESS  Contact address for Let's Encrypt expiry notices (optional, used with --domain).
  --http           Serve plain HTTP on port 80 through Caddy (testing or a trusted internal network).
  --no-proxy       Don't use a web server: the app itself listens on all interfaces on --port (1024 or higher).

Other options:
  --port PORT      Port the app listens on (default 3000; internal unless --no-proxy).
  --repo URL|PATH  Git repository to install from (default $DEFAULT_REPO).
  --branch NAME    Branch to install (default main).
  --yes            Don't ask questions.
  --force          Install again over an existing installation: apply new settings and rebuild (keeps all data).
  -h, --help       Show this help.

When CodeClass was installed before, its settings are reused for any option you leave out.
EOF
}

need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 needs a value"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) need_value "$@"; DOMAIN="$2"; MODE=https; shift 2 ;;
    --email) need_value "$@"; EMAIL="$2"; shift 2 ;;
    --http) MODE=http; DOMAIN=""; shift ;;
    --no-proxy) MODE=none; DOMAIN=""; shift ;;
    --port) need_value "$@"; PORT="$2"; shift 2 ;;
    --repo) need_value "$@"; REPO="$2"; shift 2 ;;
    --branch) need_value "$@"; BRANCH="$2"; shift 2 ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

# --- checks -------------------------------------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "run this as root, e.g. sudo $0"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != ubuntu ]]; then
    warn "This installer is written for Ubuntu; this looks like ${PRETTY_NAME:-an unknown system}. Continuing anyway."
  fi
fi
command -v systemctl >/dev/null || die "systemd is required"

HAS_RELEASE=0
if [[ -L "$APP_HOME/current" && -d "$(readlink -f "$APP_HOME/current")" ]]; then HAS_RELEASE=1; fi
if [[ -f "$CONF_DIR/install.conf" && $HAS_RELEASE -eq 1 && $FORCE -eq 0 ]]; then
  die "CodeClass is already installed. Use 'sudo codeclass-update' to update it, or run this again with --force to change its settings."
fi

# Reuse the settings of a previous installation (also one removed with `codeclass-uninstall` without --purge).
for old_conf in "$CONF_DIR/install.conf" "$CONF_DIR/install.conf.uninstalled"; do
  [[ -f "$old_conf" ]] || continue
  eval "$(
    # shellcheck disable=SC1090
    . "$old_conf"
    printf 'OLD_REPO=%q OLD_BRANCH=%q OLD_MODE=%q OLD_DOMAIN=%q OLD_EMAIL=%q OLD_PORT=%q\n' \
      "${REPO:-}" "${BRANCH:-}" "${MODE:-}" "${DOMAIN:-}" "${EMAIL:-}" "${PORT:-}"
  )"
  if [[ -z "$MODE" && -n "$OLD_MODE" ]]; then
    MODE="$OLD_MODE"
    DOMAIN="$OLD_DOMAIN"
    EMAIL="${EMAIL:-$OLD_EMAIL}"
  fi
  REPO="${REPO:-$OLD_REPO}"
  BRANCH="${BRANCH:-$OLD_BRANCH}"
  PORT="${PORT:-$OLD_PORT}"
  info "reusing the settings of the previous installation ($old_conf) for options not given"
  break
done
REPO="${REPO:-$DEFAULT_REPO}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

if [[ -z "$MODE" ]]; then
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then
    MODE=http
    warn "No --domain given: serving plain HTTP on port 80. Use --domain for HTTPS."
  else
    echo "Which web address will students and teachers use?"
    echo "  Enter a domain name that points at this server (e.g. codeclass.school.org) for automatic HTTPS,"
    read -r -p "  or leave it empty for plain HTTP on port 80: " DOMAIN
    if [[ -n "$DOMAIN" ]]; then
      MODE=https
      read -r -p "  Email for Let's Encrypt notices (optional): " EMAIL
    else
      MODE=http
    fi
  fi
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((10#$PORT < 1 || 10#$PORT > 65535)); then die "--port must be a number from 1 to 65535"; fi
PORT=$((10#$PORT))
if [[ "$MODE" == none ]] && ((PORT < 1024)); then
  die "--no-proxy needs a port of 1024 or higher (use --http or --domain to serve ports 80/443 through Caddy)"
fi
if [[ "$MODE" != none ]] && ((PORT == 80 || PORT == 443)); then
  die "--port $PORT is used by the web server; pick another internal port (the default 3000 is fine)"
fi
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch has unexpected characters"
if [[ -n "$EMAIL" && ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  die "--email doesn't look like an email address"
fi
if [[ "$MODE" == https && ! "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then
  die "--domain must be a hostname like codeclass.school.org"
fi

# Local repository paths are stored as absolute paths and cloned with file:// (so shallow clones work). Such a
# checkout usually belongs to another user, which git refuses to read as root unless told the directory is safe.
SOURCE="$REPO"
GIT=(git)
if [[ -d "$REPO" ]]; then
  REPO="$(cd "$REPO" && pwd -P)"
  SOURCE="file://$REPO"
  GIT=(git -c "safe.directory=*")
fi

step "Installing CodeClass (${MODE}${DOMAIN:+, $DOMAIN}) from $REPO ($BRANCH)"

# --- packages -----------------------------------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
# Wait for the apt lock (fresh servers often run unattended-upgrades right after boot) and keep existing config files.
APT=(apt-get -q -y -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
apt_update() {
  local tries=0
  until "${APT[@]}" update >/dev/null; do
    ((++tries < 20)) || die "apt-get update kept failing"
    warn "apt is busy or unreachable; retrying in 15 seconds"
    sleep 15
  done
}

step "Installing system packages"
apt_update
# build-essential + python3: compile the SQLite driver if no prebuilt binary matches this machine.
"${APT[@]}" install ca-certificates curl gnupg git build-essential python3 >/dev/null
ok "base packages"

# --- source (fetched before changing Node.js or Caddy, so a wrong repository or branch changes nothing else) ------
step "Downloading CodeClass"
WORK="$(mktemp -d)"
STAGED_SITE=""
STAGED_MAIN=""
VALIDATE_MAIN=""
cleanup() {
  rm -rf "$WORK"
  rm -f "$STAGED_SITE" "$STAGED_MAIN" "$VALIDATE_MAIN"
}
trap cleanup EXIT
"${GIT[@]}" clone --quiet --depth 1 --branch "$BRANCH" "$SOURCE" "$WORK/src" || die "could not clone $REPO ($BRANCH)"
for file in install.sh update.sh uninstall.sh codeclass.service; do
  [[ -f "$WORK/src/deploy/$file" ]] || die "$REPO ($BRANCH) has no deploy/$file"
done
grep -q '^# DEPLOY_API=2' "$WORK/src/deploy/update.sh" ||
  die "branch $BRANCH has deploy scripts older than this installer; install a newer branch or use the installer from that branch"
ok "commit $(git -C "$WORK/src" rev-parse --short=10 HEAD)"

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Prefer the system Node.js in /usr/bin (what NodeSource installs); another `node` earlier in PATH may be older.
NODE_BIN=""
# A snap-packaged node (/snap/bin/node) can't run inside the service's sandbox, so it doesn't count.
for candidate in /usr/bin/node "$(command -v node || true)"; do
  [[ -n "$candidate" && -x "$candidate" ]] || continue
  [[ "$(readlink -f "$candidate")" == /snap/* || "$(readlink -f "$candidate")" == /usr/bin/snap ]] && continue
  if (($(node_major "$candidate") >= MIN_NODE_MAJOR)); then
    NODE_BIN="$candidate"
    break
  fi
done
if [[ -z "$NODE_BIN" ]]; then
  step "Installing Node.js $NODE_MAJOR (NodeSource)"
  # Ubuntu's own (older) nodejs/libnode packages conflict with NodeSource's nodejs package: remove them first.
  # shellcheck disable=SC2016 # dpkg-query format strings, not shell expansions
  mapfile -t distro_node < <(dpkg-query -W -f='${db:Status-Abbrev} ${binary:Package} ${Version}\n' nodejs npm 'libnode*' 2>/dev/null |
    awk '$1 == "ii" && $3 !~ /nodesource/ {print $2}' || true)
  if ((${#distro_node[@]} > 0)); then
    warn "Ubuntu's ${distro_node[*]} must be replaced by Node.js $NODE_MAJOR from NodeSource. apt would remove:"
    apt-get -s remove "${distro_node[@]}" 2>/dev/null | awk '/^Remv/ {print "      " $2}' || true
    if [[ $ASSUME_YES -eq 0 ]]; then
      [[ -t 0 ]] || die "re-run with --yes to allow removing these packages"
      read -r -p "    Remove them? [y/N] " answer
      [[ "$answer" =~ ^[Yy] ]] || die "cancelled; install Node.js $MIN_NODE_MAJOR or newer yourself, then run the installer again"
    fi
    "${APT[@]}" remove "${distro_node[@]}"
  fi
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  chmod 0644 /etc/apt/keyrings/nodesource.gpg /etc/apt/sources.list.d/nodesource.list
  apt_update
  "${APT[@]}" install nodejs >/dev/null
  NODE_BIN=/usr/bin/node
  (($(node_major "$NODE_BIN") >= MIN_NODE_MAJOR)) || die "Node.js $NODE_MAJOR did not install correctly"
fi
[[ -x "$(dirname "$NODE_BIN")/npm" ]] || die "npm was not found next to $NODE_BIN"
ok "Node.js $("$NODE_BIN" --version) at $NODE_BIN"

if [[ "$MODE" != none ]]; then
  if ! command -v caddy >/dev/null; then
    step "Installing the Caddy web server"
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt_update
    "${APT[@]}" install caddy >/dev/null
  fi
  ok "Caddy $(caddy version | awk '{print $1}')"
fi

# --- user and folders ---------------------------------------------------------------------------------------------
step "Creating the codeclass user and folders"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin --user-group "$APP_USER"
fi
# Code is root-owned and read-only for the app; only its data folder is writable by it. Backups are root-only.
# (Releases built by older scripts are migrated by codeclass-update.)
install -d -o root -g root -m 0755 "$APP_HOME" "$APP_HOME/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"
ok "$APP_HOME (code), $DATA_DIR (database), $BACKUP_DIR (backups), $CONF_DIR (settings)"

# --- web server configuration and settings ---------------------------------------------------------------------
REPLACE_STOCK=0
if [[ "$MODE" != none ]]; then
  step "Checking the Caddy configuration"
  # The packaged Caddyfile only serves a placeholder page on :80; it is replaced only while unmodified.
  caddyfile_is_stock() {
    [[ -f "$CADDYFILE" ]] || return 0
    local stock
    # shellcheck disable=SC2016 # dpkg-query format string
    stock="$(dpkg-query -W -f='${Conffiles}\n' caddy 2>/dev/null | awk -v f="$CADDYFILE" '$1 == f {print $2}' || true)"
    [[ -n "$stock" && "$(md5sum <"$CADDYFILE" | cut -d' ' -f1)" == "$stock" ]]
  }
  STAGED_SITE="$(mktemp /etc/caddy/.codeclass.caddy.XXXXXX)"
  {
    echo "# CodeClass. Managed by the CodeClass install/uninstall scripts; changes are overwritten."
    if [[ "$MODE" == https ]]; then echo "$DOMAIN {"; else echo ":80 {"; fi
    if [[ -n "$EMAIL" && "$MODE" == https ]]; then printf '\ttls %s\n' "$EMAIL"; fi
    printf '\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$PORT"
  } >"$STAGED_SITE"
  STAGED_MAIN="$(mktemp /etc/caddy/.Caddyfile.XXXXXX)"
  if caddyfile_is_stock; then
    REPLACE_STOCK=1
    printf 'import %s\n' "$CADDY_SITE" >"$STAGED_MAIN"
  else
    cat "$CADDYFILE" >"$STAGED_MAIN"
    grep -qxF "import $CADDY_SITE" "$STAGED_MAIN" || printf '\nimport %s\n' "$CADDY_SITE" >>"$STAGED_MAIN"
  fi
  # Validate a copy that imports the staged site file, so nothing live changes if Caddy rejects it.
  VALIDATE_MAIN="$(mktemp /etc/caddy/.Caddyfile-check.XXXXXX)"
  sed "s#^import $CADDY_SITE\$#import $STAGED_SITE#" "$STAGED_MAIN" >"$VALIDATE_MAIN"
  if ! caddy_out="$(caddy validate --adapter caddyfile --config "$VALIDATE_MAIN" 2>&1)"; then
    printf '%s\n' "$caddy_out" | tail -n 5 >&2
    die "Caddy rejected the configuration (above). If your Caddyfile already serves ${DOMAIN:-port 80}, remove that site or use another --domain."
  fi
  ok "valid"
fi

step "Writing settings"
# From here on a dropped SSH session must not stop the installer half-way (output then simply goes nowhere).
trap '' HUP PIPE
STAMP="$(date -u +%Y%m%d-%H%M%S)"
# Keep copies to put back if the rebuild fails, so the running release isn't restarted with settings that don't match
# the web server.
PREV_ENV=""
PREV_CONF=""
if [[ -f "$ENV_FILE" ]]; then
  cp -p "$ENV_FILE" "$ENV_FILE.$STAMP.bak"
  PREV_ENV="$ENV_FILE.$STAMP.bak"
  info "previous settings saved as $PREV_ENV"
fi
if [[ -f "$CONF_DIR/install.conf" ]]; then
  cp -p "$CONF_DIR/install.conf" "$WORK/install.conf"
  PREV_CONF="$WORK/install.conf"
fi

# Settings this installer manages; every other line of an existing codeclass.env (comments included) is kept, and a
# DATABASE_PATH set by hand is kept too. When it was and stays a --no-proxy install, HOST / COOKIE_SECURE set by hand
# (e.g. behind the school's own TLS proxy) are kept as well.
old_value() { grep -E "^[[:space:]]*$1=" "$PREV_ENV" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
DB_PATH="$(old_value DATABASE_PATH)"
DB_PATH="${DB_PATH:-$DATA_DIR/codeclass.db}"
case "$MODE" in
  https) HOST_VALUE=127.0.0.1 COOKIE_VALUE=1 ;;
  http) HOST_VALUE=127.0.0.1 COOKIE_VALUE=0 ;;
  none)
    HOST_VALUE="" COOKIE_VALUE=0
    if [[ "${OLD_MODE:-}" == none ]]; then HOST_VALUE="$(old_value HOST)" COOKIE_VALUE="$(old_value COOKIE_SECURE)"; fi
    ;;
esac
{
  if [[ -n "$PREV_ENV" ]]; then
    grep -vE '^[[:space:]]*(NODE_ENV|PORT|HOST|DATABASE_PATH|COOKIE_SECURE)=' "$PREV_ENV" || true
  else
    echo "# CodeClass runtime settings (read by the codeclass systemd service). Restart after editing:"
    echo "#   sudo systemctl restart codeclass"
    echo "# To change the domain, port or mode, run the installer again with --force (it also updates the web server)."
    echo "# HOST: the interface to listen on (unset = all). COOKIE_SECURE=1 when people use the site over HTTPS."
  fi
  echo "NODE_ENV=production"
  echo "PORT=$PORT"
  if [[ -n "$HOST_VALUE" ]]; then echo "HOST=$HOST_VALUE"; fi
  echo "DATABASE_PATH=$DB_PATH"
  echo "COOKIE_SECURE=${COOKIE_VALUE:-0}"
} >"$ENV_FILE.new"
chown root:"$APP_USER" "$ENV_FILE.new"
chmod 0640 "$ENV_FILE.new"
mv -f "$ENV_FILE.new" "$ENV_FILE"
{
  echo "# Written by deploy/install.sh; read by codeclass-update and codeclass-uninstall."
  printf 'REPO=%q\nBRANCH=%q\nMODE=%q\nDOMAIN=%q\nEMAIL=%q\nPORT=%q\nNODE_BIN=%q\nINSTALLED_AT=%q\n' \
    "$REPO" "$BRANCH" "$MODE" "$DOMAIN" "$EMAIL" "$PORT" "$NODE_BIN" "$STAMP"
} >"$CONF_DIR/install.conf"
chmod 0600 "$CONF_DIR/install.conf"
rm -f "$CONF_DIR/install.conf.uninstalled"
ok "$ENV_FILE, $CONF_DIR/install.conf"

# The admin commands come from root's own clone. Installed now so a failed install can be removed cleanly.
install -m 0755 -o root -g root "$WORK/src/deploy/update.sh" /usr/local/sbin/codeclass-update
install -m 0755 -o root -g root "$WORK/src/deploy/uninstall.sh" /usr/local/sbin/codeclass-uninstall
REMOVE_HINT=", or remove it with: sudo codeclass-uninstall"

# --- build and start (codeclass-update does the release handling: backups, health checks, rollback) ---------------
if [[ $HAS_RELEASE -eq 1 ]]; then
  if ! /usr/local/sbin/codeclass-update --force --yes; then
    # The previous release is running again (or never stopped): give it back its own settings.
    if [[ -n "$PREV_ENV" ]]; then cp -p "$PREV_ENV" "$ENV_FILE"; fi
    if [[ -n "$PREV_CONF" ]]; then cp -p "$PREV_CONF" "$CONF_DIR/install.conf"; fi
    systemctl try-restart codeclass || true
    die "the rebuild failed (see above), so the previous settings were put back and the web server was not changed"
  fi
else
  rm -f "$APP_HOME/current"
  /usr/local/sbin/codeclass-update --install --yes
fi

# --- web server ---------------------------------------------------------------------------------------------------
reload_caddy() {
  if systemctl is-active --quiet caddy; then systemctl reload caddy; else systemctl restart caddy; fi
}
if [[ "$MODE" != none ]]; then
  step "Switching on the Caddy site"
  # Keep the live files, so they can be put back if the final configuration doesn't load.
  for live in "$CADDYFILE" "$CADDY_SITE"; do
    if [[ -f "$live" ]]; then cp -p "$live" "$WORK/$(basename "$live").live"; fi
  done
  if [[ $REPLACE_STOCK -eq 1 && -f "$CADDYFILE" ]]; then
    cp -p "$CADDYFILE" "$CADDYFILE.codeclass-original"
  fi
  chmod 0644 "$STAGED_SITE" "$STAGED_MAIN"
  mv -f "$STAGED_SITE" "$CADDY_SITE"
  mv -f "$STAGED_MAIN" "$CADDYFILE"
  STAGED_SITE=""
  STAGED_MAIN=""
  if ! caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1 || ! reload_caddy; then
    for live in "$CADDYFILE" "$CADDY_SITE"; do
      if [[ -f "$WORK/$(basename "$live").live" ]]; then cp -p "$WORK/$(basename "$live").live" "$live"; else rm -f "$live"; fi
    done
    reload_caddy || true
    if [[ $HAS_RELEASE -eq 1 ]]; then
      # Keep the app on the settings that match the web server it still has.
      if [[ -n "$PREV_ENV" ]]; then cp -p "$PREV_ENV" "$ENV_FILE"; fi
      if [[ -n "$PREV_CONF" ]]; then cp -p "$PREV_CONF" "$CONF_DIR/install.conf"; fi
      systemctl try-restart codeclass || true
    fi
    die "Caddy couldn't load the new site, so its previous configuration was put back (check: caddy validate --config $CADDYFILE). Fix it and run the installer again with --force."
  fi
  systemctl enable --quiet caddy
  ok "Caddy serves ${DOMAIN:-port 80} → 127.0.0.1:$PORT"
elif [[ -f "$CADDY_SITE" ]]; then
  # Switching to --no-proxy: stop serving CodeClass through Caddy, which an earlier install set up.
  rm -f "$CADDY_SITE"
  if [[ -f "$CADDYFILE" ]]; then
    sed -i "\#^import $CADDY_SITE\$#d" "$CADDYFILE"
    # If nothing else is left, put back the stock Caddyfile the earlier install replaced.
    if ! grep -qvE '^[[:space:]]*(#.*)?$' "$CADDYFILE" && [[ -f "$CADDYFILE.codeclass-original" ]]; then
      mv -f "$CADDYFILE.codeclass-original" "$CADDYFILE"
    fi
  fi
  reload_caddy || warn "Caddy didn't reload; check 'systemctl status caddy'"
fi

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  step "Opening the firewall (ufw)"
  case "$MODE" in
    https) ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ok "ports 80 and 443" ;;
    http) ufw allow 80/tcp >/dev/null && ok "port 80" ;;
    none) ufw allow "$PORT/tcp" >/dev/null && ok "port $PORT" ;;
  esac
fi

trap - ERR
case "$MODE" in
  https) URL="https://$DOMAIN" ;;
  http) URL="http://$(hostname -I 2>/dev/null | awk '{print $1}')" ;;
  none) URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT" ;;
esac

step "${G}CodeClass is installed${N}"
info "Open $URL and create the admin account (the first person to visit sets it up)."
if [[ "$MODE" != https ]]; then
  warn "Without HTTPS, browsers can't pause programs for typed input, so programs read from an"
  warn "'Input for your program' box instead, and sign-in cookies travel unencrypted. When the server has a"
  warn "public name, switch with: sudo $0 --force --domain your.domain"
fi
info "Update:     sudo codeclass-update"
info "Uninstall:  sudo codeclass-uninstall"
info "Logs:       journalctl -u codeclass -f"
info "Settings:   $ENV_FILE   Database: $DATA_DIR/codeclass.db   Backups: $BACKUP_DIR"
