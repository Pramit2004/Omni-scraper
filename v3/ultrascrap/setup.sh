#!/bin/bash

# ============================================================
#  ULTRASCRAP — Setup Script
#  Industry-Grade Web Scraping Platform
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}"
cat << 'EOF'
 ██╗   ██╗██╗  ████████╗██████╗  █████╗ ███████╗ ██████╗██████╗  █████╗ ██████╗ 
 ██║   ██║██║  ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗
 ██║   ██║██║     ██║   ██████╔╝███████║███████╗██║     ██████╔╝███████║██████╔╝
 ██║   ██║██║     ██║   ██╔══██╗██╔══██║╚════██║██║     ██╔══██╗██╔══██║██╔═══╝ 
 ╚██████╔╝███████╗██║   ██║  ██║██║  ██║███████║╚██████╗██║  ██║██║  ██║██║     
  ╚═════╝ ╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     
EOF
echo -e "${NC}"
echo -e "${BOLD}  Industry-Grade Intelligent Web Scraping Platform${NC}"
echo -e "  ─────────────────────────────────────────────────"
echo ""

log_step() { echo -e "${CYAN}▸${NC} ${BOLD}$1${NC}"; }
log_ok()   { echo -e "${GREEN}✔${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_err()  { echo -e "${RED}✘${NC} $1"; exit 1; }

# ── 1. System checks ──────────────────────────────────────
log_step "Checking system requirements..."

command -v node >/dev/null 2>&1 || log_err "Node.js not found. Install Node.js 18+"
command -v python3 >/dev/null 2>&1 || log_err "Python 3 not found. Install Python 3.10+"
command -v pip3 >/dev/null 2>&1 || log_err "pip3 not found."

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 18 ] && log_err "Node.js 18+ required. Found v$(node -v)"

log_ok "Node.js $(node -v) ✓"
log_ok "Python $(python3 --version) ✓"
echo ""

# ── 2. Python backend deps ─────────────────────────────────
log_step "Installing Python backend dependencies..."

pip3 install --quiet --break-system-packages \
  fastapi==0.111.0 \
  uvicorn[standard]==0.30.0 \
  playwright==1.44.0 \
  httpx==0.27.0 \
  beautifulsoup4==4.12.3 \
  lxml==5.2.2 \
  fake-useragent==1.5.1 \
  redis==5.0.4 \
  celery==5.4.0 \
  aiofiles==23.2.1 \
  python-multipart==0.0.9 \
  pydantic==2.7.1 \
  websockets==12.0 \
  rich==13.7.1 \
  tldextract==5.1.2 \
  cssselect==1.2.0 \
  extruct==0.17.0 \
  orjson==3.10.3 \
  python-dotenv==1.0.1

log_ok "Python packages installed"

# ── 3. Install Playwright browsers ────────────────────────
log_step "Installing Playwright browsers (Chromium + Firefox)..."
python3 -m playwright install chromium firefox --with-deps --quiet 2>/dev/null || \
  python3 -m playwright install chromium firefox
log_ok "Playwright browsers ready"

# ── 4. Frontend deps ───────────────────────────────────────
log_step "Installing frontend dependencies..."
cd frontend
npm install --silent
cd ..
log_ok "Frontend packages installed"

# ── 5. Environment file ────────────────────────────────────
log_step "Creating .env file..."
if [ ! -f .env ]; then
cat > .env << 'ENVEOF'
# ── UltraScrap Environment ──────────────────────
APP_HOST=0.0.0.0
APP_PORT=8000
FRONTEND_PORT=3000

# Redis (used for job queue & telemetry)
REDIS_URL=redis://localhost:6379/0

# Scraper defaults
DEFAULT_CONCURRENCY=3
MAX_CONCURRENCY=20
DEFAULT_TIMEOUT=30
REQUEST_DELAY_MIN=1.0
REQUEST_DELAY_MAX=3.5

# Proxy (optional — leave blank to use direct connection)
PROXY_LIST=

# Rate control
AIMD_INCREASE_STEP=1
AIMD_DECREASE_FACTOR=0.5
TARGET_ERROR_RATE=0.02

# Export
EXPORT_DIR=./exports
ENVEOF
log_ok ".env created"
else
  log_warn ".env already exists, skipping"
fi

# ── 6. Create exports dir ──────────────────────────────────
mkdir -p exports
log_ok "Export directory ready"

# ── 7. Build frontend ──────────────────────────────────────
log_step "Building frontend..."
cd frontend
npm run build --silent
cd ..
log_ok "Frontend built"

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  ✔  ULTRASCRAP is ready!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Start the platform:${NC}"
echo -e "  ${CYAN}./start.sh${NC}"
echo ""
echo -e "  ${BOLD}Or start manually:${NC}"
echo -e "  Backend : ${CYAN}python3 backend/main.py${NC}"
echo -e "  Frontend: ${CYAN}cd frontend && npm run dev${NC}"
echo ""
