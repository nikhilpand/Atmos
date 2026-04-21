#!/bin/bash
# ATMOS — Multi-Server Deployment Script
# Frontend: Vercel
# Backend:  HuggingFace Spaces (Control, Media, Meta, Subs)
set -euo pipefail

PROJECT_DIR="/home/nikhil/Desktop/jio-to-gdrive"

echo "═══════════════════════════════════════════"
echo "🚀 ATMOS — Full Stack Deployment"
echo "═══════════════════════════════════════════"

# ─── 1. Backend → HuggingFace Spaces ───
echo ""
echo "▸ [1/2] Deploying Backend Microservices to Hugging Face..."

SERVERS=("hf_repo" "media_server" "meta_server" "subs_server")

for SERVER in "${SERVERS[@]}"; do
    SERVER_DIR="${PROJECT_DIR}/${SERVER}"
    if [ -d "${SERVER_DIR}/.git" ]; then
        echo "  → Deploying ${SERVER}..."
        cd "${SERVER_DIR}"
        git add .
        git commit -m "Deploy: ATMOS Update ($(date '+%Y-%m-%d %H:%M'))" 2>/dev/null || echo "    ℹ️ No changes to commit in ${SERVER}"
        git push origin main && echo "    ✅ ${SERVER} pushed successfully!" || echo "    ⚠️ Push failed for ${SERVER}"
    else
        echo "  ⚠️ ${SERVER_DIR} is not a git repo or doesn't exist"
    fi
done

# ─── 2. Frontend → Vercel ───
echo ""
echo "▸ [2/2] Deploying Frontend to Vercel..."
FRONTEND_DIR="${PROJECT_DIR}/frontend"

if [ -d "${FRONTEND_DIR}" ]; then
    cd "${FRONTEND_DIR}"
    echo "  → Running npx vercel..."
    # Using npx so you don't need vercel installed globally.
    # Note: If this is your first time, it will prompt you to log in and link your Vercel project.
    npx vercel --prod && echo "  ✅ Frontend deployed to Vercel!" || echo "  ⚠️ Vercel deploy failed"
else
    echo "  ⚠️ Frontend directory not found!"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "✅ All Deployments Initiated!"
echo "═══════════════════════════════════════════"
