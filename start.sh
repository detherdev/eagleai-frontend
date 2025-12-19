#!/bin/bash
# Start script for EagleAI local development

echo "🚀 Starting EagleAI..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if .env.local exists (optional for SAM3 testing)
if [ ! -f ".env.local" ]; then
    echo "⚠️  Note: .env.local not found. GEMINI_API_KEY is optional for SAM3 testing."
    echo ""
fi

echo "🌐 Starting development server on http://localhost:3000"
echo ""
npm run dev

