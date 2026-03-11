#!/bin/bash
set -e

echo "=== UltraScrap Build Script ==="
echo "Python: $(python3 --version)"

# 1. Remove broken yarn repo
rm -f /etc/apt/sources.list.d/yarn.list
rm -f /etc/apt/sources.list.d/yarn.list.save

# 2. Install Chromium system dependencies
apt-get update -qq && apt-get install -y \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libatspi2.0-0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libxkbcommon0 \
  libasound2t64 \
  libx11-xcb1 \
  libxcb-dri3-0 \
  libxss1 \
  libnss3

# 3. Install Python deps with exact playwright version
pip install -r requirements.txt

# 4. Install Playwright browser to the DEFAULT cache path
# Runtime looks at /opt/render/.cache/ms-playwright — so install there
export PLAYWRIGHT_BROWSERS_PATH=/opt/render/.cache/ms-playwright
python3 -m playwright install chromium

# 5. Build frontend
cd frontend
npm install
npm run build
cd ..

echo "Python version used: $(python3 --version)"
echo "Playwright version: $(python3 -m playwright --version)"
echo "=== Build complete ==="