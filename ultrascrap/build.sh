#!/bin/bash
set -e

echo "=== UltraScrap Build Script ==="

# 1. Remove broken yarn repo that blocks apt
sudo rm -f /etc/apt/sources.list.d/yarn.list
sudo rm -f /etc/apt/sources.list.d/yarn.list.save

# 2. Install Chromium system dependencies directly (Ubuntu 24 compatible)
sudo apt-get update -qq && sudo apt-get install -y \
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
  libasound2t64

# 3. Install Python deps
pip install -r requirements.txt

# 4. Install Playwright + Chromium browser binary
playwright install chromium

# 5. Build frontend
cd frontend
npm install
npm run build
cd ..

echo "=== Build complete ==="