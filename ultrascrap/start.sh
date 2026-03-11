#!/bin/bash
# UltraScrap — Start Platform

trap 'kill $(jobs -p) 2>/dev/null; echo ""; echo "UltraScrap stopped."; exit' INT TERM

echo -e "\033[0;36m▸\033[0m Starting UltraScrap backend..."
python3 backend/main.py &
BACKEND_PID=$!

sleep 2

echo -e "\033[0;36m▸\033[0m Starting UltraScrap frontend..."
cd frontend && npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "\033[1;32m✔ UltraScrap running!\033[0m"
echo -e "  UI      → \033[0;36mhttp://localhost:3000\033[0m"
echo -e "  API     → \033[0;36mhttp://localhost:8000\033[0m"
echo -e "  API Docs→ \033[0;36mhttp://localhost:8000/docs\033[0m"
echo ""
echo "Press Ctrl+C to stop."

wait
