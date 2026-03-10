#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  OMNI-SCRAPER — One-Command Setup for GitHub Codespaces
#  Run: bash setup.sh
# ═══════════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${CYAN}${BOLD}  ⬡  OMNI-SCRAPER SETUP${NC}"
echo -e "${CYAN}  ─────────────────────────────────────${NC}"
echo ""

step() { echo -e "${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

# ── Fix broken yarn apt repo (breaks playwright --with-deps) ───
step "Fixing apt repositories..."
sudo rm -f /etc/apt/sources.list.d/yarn.list 2>/dev/null || true
sudo rm -f /usr/share/keyrings/yarnkey.gpg 2>/dev/null || true
sudo apt-get update -qq 2>/dev/null || true
ok "apt repos clean"

# ── Python ─────────────────────────────────────────────────────
step "Installing Python dependencies..."
pip install -r requirements.txt --break-system-packages 2>/dev/null || \
pip install -r requirements.txt
ok "Python packages installed"

# ── Playwright (install browser only, deps via apt workaround) ──
step "Installing Playwright browsers..."
# Install system deps manually to bypass the broken yarn repo
sudo apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
  libpango-1.0-0 libcairo2 libatspi2.0-0 \
  2>/dev/null || warn "Some system deps skipped"

playwright install chromium
ok "Playwright + Chromium ready"

# ── spaCy model ────────────────────────────────────────────────
step "Downloading spaCy NLP model..."
python -m spacy download en_core_web_sm 2>/dev/null && ok "NLP model ready" || warn "spaCy model skipped (optional)"

# ── Frontend ───────────────────────────────────────────────────
step "Installing frontend dependencies..."
cd frontend && npm install && cd ..
ok "Frontend (React + Vite) ready"

# ── .env ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env created from template — add your API keys!"
else
  ok ".env already exists"
fi

# ── Infra ──────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  step "Starting Redis + Qdrant via Docker..."
  docker compose -f infra/docker-compose.yml up -d
  ok "Redis (6379) + Qdrant (6333) running"
else
  warn "Docker not found — Redis/Qdrant skipped (optional for basic usage)"
fi

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ SETUP COMPLETE${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. ${YELLOW}nano .env${NC}  — add your API keys"
echo -e "  2. ${YELLOW}uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload${NC}"
echo -e "  3. ${YELLOW}cd frontend && npm run dev${NC}  (open a new terminal)"
echo -e "  4. In PORTS tab → port 8000 → right-click → Set Visibility → ${YELLOW}Public${NC}"
echo ""