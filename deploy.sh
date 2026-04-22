#!/bin/bash
echo "🚀 Deploying ATMOS Infrastructure..."

# Add all changes
git add .

# Commit changes
if [ -z "$1" ]; then
    COMMIT_MSG="auto: deployment update $(date +'%Y-%m-%d %H:%M:%S')"
else
    COMMIT_MSG="$1"
fi

# Try to commit, but don't fail if there are no changes
git commit -m "$COMMIT_MSG" || echo "No new changes to commit."

# Push to GitHub
echo "📦 Pushing to GitHub (This will automatically trigger Vercel and Hugging Face deployments)..."
git push origin main

echo "✅ Push complete!"
echo "⏳ Vercel will deploy the frontend automatically."
echo "⏳ GitHub Actions will deploy Hugging Face spaces automatically."
