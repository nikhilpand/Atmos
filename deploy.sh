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
echo "📦 Pushing to GitHub..."
git push origin main

echo "🌐 Deploying Frontend via Vercel CLI..."
npx vercel --prod --yes

echo "🤖 Triggering Hugging Face Deployment via GitHub Actions..."
gh workflow run deploy.yml --ref main

echo "✅ Deployment triggered successfully!"
echo "Check your Hugging Face space in ~2 minutes."
