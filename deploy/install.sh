#!/usr/bin/env bash
# CodeClass installer for Ubuntu (22.04 / 24.04 or newer).
#
#   sudo ./deploy/install.sh --domain codeclass.yourschool.org --email it@yourschool.org
#   sudo ./deploy/install.sh --http          # plain HTTP on port 80 (testing / internal network)
#   sudo ./deploy/install.sh --no-proxy      # no web server; the app listens on --port itself
#
# Installs Node.js 24 (NodeSource) and Caddy (automatic HTTPS) if needed, creates a `codeclass` system user, builds the
# app from GitHub into /opt/codeclass, keeps data in /var/lib/codeclass and runs it as the `codeclass` systemd service.
# Afterwards use `sudo codeclass-update` and `sudo codeclass-uninstall`.
set -Eeuo pipefail

DEFAULT_REPO="https://github.com/Marquette-Catholic-High-School/coding.git"
APP_HOME=/opt/codeclass
DATA_DIR=/var/lib/codeclass
CONF_DIR=/etc/codeclass
SERVICE=codeclass
APP_USER=codeclass
CADDY_SITE=/etc/caddy/codeclass.caddy
NODE_MAJOR=24
MIN_NODE_MAJOR=22

REPO="$DEFAULT_REPO"
BRANCH=main
DOMAIN=""
EMAIL=""
MODE=""   # https | http | none
PORT=3000
ASSUME_YES=0
FORCE=0

# --- output -------------------------------------------------------------------------------------------------------
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '%s    ✔ %s%s\n' "$G" "$*" "$N"; }
warn() { printf '%s    ! %s%s\n' "$Y" "$*" "$N" >&2; }
die() { printf '%sError: %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
trap 'die "install failed on line $LINENO (exit $?). Nothing was removed; fix the problem and run the installer again with --force."' ERR

usage() {
  cat <<EOF
Install CodeClass on this Ubuntu server.

Usage: sudo $0 [options]

Choose how people reach the site (asked interactively if you pick none):
  --domain NAME    Public hostname, e.g. codeclass.school.org. Caddy gets a free HTTPS certificate from
                   Let's Encrypt. The name must already point at this server, with ports 80 and 443 open.
  --email ADDRESS  Contact address for Let's Encrypt expiry notices (optional, used with --domain).
  --http           Serve plain HTTP on port 80 through Caddy (testing or a trusted internal network).
  --no-proxy       Don't install a web server: the app itself listens on all interfaces on --port.

Other options:
  --port PORT      Port the app listens on internally (default 3000).
  --repo URL|PATH  Git repository to install from (default $DEFAULT_REPO).
  --branch NAME    Branch to install (default main).
  --yes            Don't ask questions.
  --force          Install again over an existing installation (keeps the database).
  -h, --help       Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; MODE=https; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --http) MODE=http; shift ;;
    --no-proxy) MODE=none; shift ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

# --- checks -------------------------------------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "run this as root, e.g. sudo $0"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || die "--port must be a number from 1 to 65535"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch has unexpected characters"
[[ -z "$EMAIL" || "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || die "--email doesn't look like an email address"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != ubuntu ]]; then
    warn "This installer is written for Ubuntu; this looks like ${PRETTY_NAME:-an unknown system}. Continuing anyway."
  fi
fi
command -v systemctl >/dev/null || die "systemd is required"

if [[ -f "$CONF_DIR/install.conf" && $FORCE -eq 0 ]]; then
  die "CodeClass is already installed. Use 'sudo codeclass-update' to update it, or run this again with --force."
fi

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
if [[ "$MODE" == https ]]; then
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] ||
    die "--domain must be a hostname like codeclass.school.org"
fi
if [[ "$MODE" != none ]] && ((PORT == 80 || PORT == 443)); then
  die "--port $PORT is used by the web server; pick another internal port (the default 3000 is fine)"
fi

# Local repository paths are cloned with file:// so shallow clones work. Such a checkout is usually owned by another
# user, which git refuses to read as root unless told the directory is safe.
SOURCE="$REPO"
GIT=(git)
if [[ -d "$REPO" ]]; then
  SOURCE="file://$(cd "$REPO" && pwd)"
  GIT=(git -c "safe.directory=*")
fi

step "Installing CodeClass (${MODE}${DOMAIN:+, $DOMAIN}) from $REPO ($BRANCH)"

# --- packages -----------------------------------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
step "Installing system packages"
apt-get update -q
# build-essential + python3: compile the SQLite driver if no prebuilt binary matches this machine.
apt-get install -y -q ca-certificates curl gnupg git build-essential python3 >/dev/null
ok "base packages"

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Prefer the system Node.js in /usr/bin (what NodeSource installs); another `node` earlier in PATH may be older.
NODE_BIN=""
for candidate in /usr/bin/node "$(command -v node || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]] && (($(node_major "$candidate") >= MIN_NODE_MAJOR)); then
    NODE_BIN="$candidate"
    break
  fi
done
if [[ -z "$NODE_BIN" ]]; then
  step "Installing Node.js $NODE_MAJOR (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs >/dev/null
  NODE_BIN=/usr/bin/node
fi
NODE_DIR="$(dirname "$NODE_BIN")"
[[ -x "$NODE_DIR/npm" ]] || die "npm was not found next to $NODE_BIN"
ok "Node.js $("$NODE_BIN" --version) at $NODE_BIN"

if [[ "$MODE" != none ]] && ! command -v caddy >/dev/null; then
  step "Installing Caddy web server"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy >/dev/null
fi
[[ "$MODE" == none ]] || ok "Caddy $(caddy version | awk '{print $1}')"

# --- user and directories -----------------------------------------------------------------------------------------
step "Creating the codeclass user and folders"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_HOME" --shell /usr/sbin/nologin --user-group "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_HOME" "$APP_HOME/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/backups"
install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"
ok "$APP_HOME (code), $DATA_DIR (database and backups), $CONF_DIR (settings)"

# --- build --------------------------------------------------------------------------------------------------------
# Runs a command as the app user with the chosen Node.js first in PATH.
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" "$@"; }

step "Downloading and building CodeClass"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
"${GIT[@]}" clone --quiet --depth 1 --branch "$BRANCH" "$SOURCE" "$WORK/src" || die "could not clone $REPO ($BRANCH)"
SHA="$(git -C "$WORK/src" rev-parse --short=10 HEAD)"
RELEASE="$APP_HOME/releases/$STAMP-$SHA"
mv "$WORK/src" "$RELEASE"
rmdir "$WORK"
chown -R "$APP_USER:$APP_USER" "$RELEASE"
info "commit $SHA"
(cd "$RELEASE" && as_app npm ci --no-audit --no-fund --loglevel=error)
(cd "$RELEASE" && as_app node -e "require('better-sqlite3')") 2>/dev/null ||
  (cd "$RELEASE" && as_app npm rebuild better-sqlite3 --loglevel=error)
(cd "$RELEASE" && as_app npm run build --silent)
[[ -f "$RELEASE/client/dist/index.html" ]] || die "the build did not produce client/dist/index.html"
ok "built release $(basename "$RELEASE")"

ln -sfn "$RELEASE" "$APP_HOME/current.new"
mv -T "$APP_HOME/current.new" "$APP_HOME/current"

# --- configuration ------------------------------------------------------------------------------------------------
step "Writing configuration"
HOST_LINE="HOST=127.0.0.1"
[[ "$MODE" == none ]] && HOST_LINE="# HOST=127.0.0.1   (listening on every interface: no reverse proxy)"
COOKIE_LINE="COOKIE_SECURE=0"
[[ "$MODE" == https ]] && COOKIE_LINE="COOKIE_SECURE=1"
ENV_FILE="$CONF_DIR/codeclass.env"
if [[ -f "$ENV_FILE" ]]; then
  cp -p "$ENV_FILE" "$ENV_FILE.bak"
  info "previous settings saved as $ENV_FILE.bak"
fi
{
  cat <<EOF
# CodeClass runtime settings (read by the codeclass systemd service). Restart after editing:
#   sudo systemctl restart codeclass
NODE_ENV=production
PORT=$PORT
$HOST_LINE
DATABASE_PATH=$DATA_DIR/codeclass.db
# 1 when people reach the site over HTTPS (sends cookies with the Secure flag).
$COOKIE_LINE
EOF
} >"$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
{
  echo "# Written by deploy/install.sh; read by codeclass-update and codeclass-uninstall."
  printf 'REPO=%q\nBRANCH=%q\nMODE=%q\nDOMAIN=%q\nPORT=%q\nNODE_BIN=%q\nINSTALLED_AT=%q\n' \
    "$REPO" "$BRANCH" "$MODE" "$DOMAIN" "$PORT" "$NODE_BIN" "$STAMP"
} >"$CONF_DIR/install.conf"
chmod 0640 "$CONF_DIR/install.conf"
ok "$CONF_DIR/codeclass.env, $CONF_DIR/install.conf"

# --- service ------------------------------------------------------------------------------------------------------
step "Starting the codeclass service"
sed -e "s#@NODE@#$NODE_BIN#g" -e "s#@APP_HOME@#$APP_HOME#g" -e "s#@DATA_DIR@#$DATA_DIR#g" \
  "$RELEASE/deploy/codeclass.service" >"/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"

health() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
if ! health; then
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
  die "the service did not become healthy on port $PORT (see the log above)"
fi
ok "running on 127.0.0.1:$PORT"

# --- web server ---------------------------------------------------------------------------------------------------
if [[ "$MODE" != none ]]; then
  step "Configuring Caddy"
  if [[ "$MODE" == https ]]; then
    {
      echo "# CodeClass — managed by codeclass-install/update/uninstall."
      echo "$DOMAIN {"
      [[ -n "$EMAIL" ]] && echo "	tls $EMAIL"
      echo "	encode zstd gzip"
      echo "	reverse_proxy 127.0.0.1:$PORT"
      echo "}"
    } >"$CADDY_SITE"
  else
    printf '# CodeClass — managed by codeclass-install/update/uninstall.\n:80 {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$PORT" >"$CADDY_SITE"
  fi
  CADDYFILE=/etc/caddy/Caddyfile
  IMPORT_LINE="import $CADDY_SITE"
  if [[ ! -f "$CADDYFILE" ]] || grep -q '/usr/share/caddy' "$CADDYFILE"; then
    # The stock Caddyfile only serves a placeholder page on :80; keep a copy and replace it.
    [[ -f "$CADDYFILE" ]] && cp -p "$CADDYFILE" "$CADDYFILE.codeclass-original"
    printf '%s\n' "$IMPORT_LINE" >"$CADDYFILE"
  elif ! grep -qxF "$IMPORT_LINE" "$CADDYFILE"; then
    printf '\n%s\n' "$IMPORT_LINE" >>"$CADDYFILE"
  fi
  caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1 ||
    die "Caddy rejected $CADDYFILE: run 'caddy validate --config $CADDYFILE' to see why"
  systemctl enable --quiet caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  ok "Caddy serves ${DOMAIN:-port 80} → 127.0.0.1:$PORT"
fi

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  step "Opening the firewall (ufw)"
  case "$MODE" in
    https) ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ok "ports 80 and 443" ;;
    http) ufw allow 80/tcp >/dev/null && ok "port 80" ;;
    none) ufw allow "$PORT/tcp" >/dev/null && ok "port $PORT" ;;
  esac
fi

# --- admin commands -----------------------------------------------------------------------------------------------
install -m 0755 "$RELEASE/deploy/update.sh" /usr/local/sbin/codeclass-update
install -m 0755 "$RELEASE/deploy/uninstall.sh" /usr/local/sbin/codeclass-uninstall
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
  warn "'Input for your program' box instead, and sign-in cookies travel unencrypted. Re-run with --domain"
  warn "for HTTPS when the server has a public name."
fi
info "Update:     sudo codeclass-update"
info "Uninstall:  sudo codeclass-uninstall"
info "Logs:       journalctl -u $SERVICE -f"
info "Settings:   $CONF_DIR/codeclass.env   Database: $DATA_DIR/codeclass.db"
