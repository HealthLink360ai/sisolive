#!/usr/bin/env bash
# SISO Live! — Local setup helper
# Run: bash setup-local.sh

set -e
echo "=== SISO Live! Local Setup ==="

# 1. Upload dir
mkdir -p /tmp/siso-uploads
echo "✓ Upload directory ready"

# 2. Install deps
cd siso-live
if [ ! -d node_modules ]; then
  npm install
fi
echo "✓ Dependencies installed"

# 3. Check .env
if [ ! -f .env ]; then
  echo "ERROR: siso-live/.env not found."
  echo "Copy siso-live/.env.example to siso-live/.env and fill in your API keys."
  exit 1
fi

MISSING=()
for VAR in ANTHROPIC_API_KEY PINECONE_API_KEY COHERE_API_KEY DATABASE_URL; do
  VAL=$(grep "^${VAR}=" .env | cut -d= -f2-)
  if [ -z "$VAL" ] || [[ "$VAL" == *"your_"* ]]; then
    MISSING+=("$VAR")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  Missing required API keys in siso-live/.env:"
  for KEY in "${MISSING[@]}"; do
    echo "   - $KEY"
  done
  echo ""
  echo "Fill these in, then re-run: bash setup-local.sh"
  exit 1
fi

echo "✓ All required API keys present"
echo ""
echo "Starting SISO Live! backend on http://localhost:3001 ..."
echo "Open siso-live-FINAL.html in your browser once the backend is running."
echo ""
npm run dev
