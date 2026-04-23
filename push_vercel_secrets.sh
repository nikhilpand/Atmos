#!/bin/bash
echo "🚀 Pushing secrets to Vercel..."

# Navigate to frontend to use Vercel CLI context
cd frontend || { echo "Error: frontend directory not found."; exit 1; }

# Determine which env file to use
ENV_FILE=""
if [ -f ../.env ]; then
    ENV_FILE="../.env"
elif [ -f .env.local ]; then
    ENV_FILE=".env.local"
else
    echo "Error: No .env or .env.local file found."
    exit 1
fi

echo "Using secrets from $ENV_FILE"

# Read .env file line by line
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    if [[ $key == \#* ]] || [[ -z $key ]]; then
        continue
    fi
    
    # Remove surrounding quotes from value if present
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    
    # Skip VERCEL specific auto-generated tokens
    if [[ $key == VERCEL_* ]]; then
        continue
    fi
    
    echo " -> Pushing $key to Vercel..."
    echo -n "$value" | npx vercel env add "$key" production,preview,development >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "    ✅ Successfully added $key"
    else
        echo "    ❌ Failed to add $key (might already exist or require confirmation)"
    fi
done < "$ENV_FILE"

echo "✅ Finished pushing secrets to Vercel."
echo "Note: You may need to trigger a new deployment for changes to take effect."
