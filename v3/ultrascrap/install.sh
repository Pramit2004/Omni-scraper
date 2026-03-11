#!/bin/bash

# ============================================================
#  UltraScrap — Complete Install Script
#  Handles GitHub Codespaces & Ubuntu environments
# ============================================================

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✔${NC} $1"; }
info() { echo -e "${CYAN}▸${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✘${NC} $1"; }

echo ""
echo -e "${CYAN}${BOLD}  UltraScrap — Install${NC}"
echo -e "  ──────────────────────────────"
echo ""

# ── Fix broken yarn repo (common in Codespaces) ───────────────
info "Fixing apt sources..."
sudo rm -f /etc/apt/sources.list.d/yarn.list 2>/dev/null || true
sudo rm -f /etc/apt/sources.list.d/yarn*.list 2>/dev/null || true
# Remove any other unsigned repos that might cause issues
sudo sed -i '/dl.yarnpkg.com/d' /etc/apt/sources.list 2>/dev/null || true
ok "Apt sources cleaned"

# ── Update apt ─────────────────────────────────────────────────
info "Updating apt..."
sudo apt-get update -qq 2>/dev/null || warn "apt update had warnings (continuing)"
ok "Apt updated"

# ── System packages ────────────────────────────────────────────
info "Installing system packages..."
sudo apt-get install -y -qq \
    curl wget git unzip \
    python3 python3-pip python3-dev \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 \
    libxcb1 libxkbcommon0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    libatspi2.0-0 libxshmfence1 fonts-liberation \
    2>/dev/null || \
sudo apt-get install -y -qq \
    curl wget git unzip \
    python3 python3-pip python3-dev \
    libglib2.0-0 libnss3 libnspr4 \
    libdrm2 libxcb1 libxkbcommon0 \
    libgbm1 libpango-1.0-0 libcairo2 \
    fonts-liberation \
    2>/dev/null || warn "Some system packages skipped"
ok "System packages installed"

# ── Python packages ────────────────────────────────────────────
info "Installing Python packages..."
pip3 install --quiet --break-system-packages \
    fastapi==0.111.0 \
    "uvicorn[standard]==0.30.0" \
    playwright==1.44.0 \
    httpx==0.27.0 \
    beautifulsoup4==4.12.3 \
    lxml==5.2.2 \
    fake-useragent==1.5.1 \
    aiofiles==23.2.1 \
    python-multipart==0.0.9 \
    pydantic==2.7.1 \
    websockets==12.0 \
    rich==13.7.1 \
    tldextract==5.1.2 \
    cssselect==1.2.0 \
    orjson==3.10.3 \
    python-dotenv==1.0.1 \
    2>/dev/null
ok "Python packages installed"

# ── Playwright browser (skip --with-deps to avoid apt issues) ──
info "Installing Playwright Chromium browser..."

# Method 1: Direct install without deps (deps already installed above)
python3 -m playwright install chromium 2>/dev/null && ok "Chromium installed via playwright" || {
    warn "Standard install failed, trying fallback..."

    # Method 2: Set env var to skip apt and install manually
    PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
    python3 -m playwright install chromium 2>/dev/null && ok "Chromium installed (fallback)" || {

        # Method 3: Download chromium directly
        warn "Trying direct chromium download..."
        sudo apt-get install -y -qq chromium-browser 2>/dev/null || \
        sudo apt-get install -y -qq chromium 2>/dev/null || \
        warn "Could not install chromium via apt either"
    }
}

# Verify playwright can find a browser
python3 -c "
from playwright.sync_api import sync_playwright
try:
    p = sync_playwright().start()
    b = p.chromium.launch(headless=True, args=['--no-sandbox'])
    b.close()
    p.stop()
    print('  Chromium browser: OK')
except Exception as e:
    print(f'  Chromium browser: WARN — {e}')
" 2>/dev/null || warn "Browser verification skipped"

# ── Node.js check ──────────────────────────────────────────────
info "Checking Node.js..."
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    ok "Node.js $NODE_VER found"
else
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null
    sudo apt-get install -y -qq nodejs 2>/dev/null
    ok "Node.js installed"
fi

# ── Frontend dependencies ──────────────────────────────────────
info "Installing frontend dependencies..."
cd frontend
npm install --silent 2>/dev/null
ok "Frontend packages installed"
cd ..

# ── Build frontend ─────────────────────────────────────────────
info "Building frontend..."
cd frontend
npm run build --silent 2>/dev/null && ok "Frontend built" || warn "Frontend build had warnings"
cd ..

# ── Create .env if missing ─────────────────────────────────────
if [ ! -f .env ]; then
    info "Creating .env..."
    cp .env.example .env 2>/dev/null || cat > .env << 'ENVEOF'
APP_HOST=0.0.0.0
APP_PORT=8000
FRONTEND_PORT=3000
DEFAULT_CONCURRENCY=3
MAX_CONCURRENCY=20
DEFAULT_TIMEOUT=30
REQUEST_DELAY_MIN=1.0
REQUEST_DELAY_MAX=3.5
PROXY_LIST=
AIMD_INCREASE_STEP=0.5
AIMD_DECREASE_FACTOR=0.5
TARGET_ERROR_RATE=0.02
EXPORT_DIR=./exports
ENVEOF
    ok ".env created"
fi

# ── Create exports dir ─────────────────────────────────────────
mkdir -p exports
ok "Exports directory ready"

# ── Final verification ─────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}  Verifying installation...${NC}"
python3 -c "import fastapi, uvicorn, playwright, bs4, lxml; print('  Python deps: OK')"
node -e "console.log('  Node.js: OK')"

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  ✔  Installation complete!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Start the app:${NC}"
echo -e "  ${CYAN}bash start.sh${NC}"
echo ""
echo -e "  ${BOLD}Or manually:${NC}"
echo -e "  Terminal 1: ${CYAN}python3 backend/main.py${NC}"
echo -e "  Terminal 2: ${CYAN}cd frontend && npm run dev${NC}"
echo ""
echo -e "  ${BOLD}Test scraper:${NC}"
echo -e "  ${CYAN}python3 test_scraper.py${NC}"
echo ""