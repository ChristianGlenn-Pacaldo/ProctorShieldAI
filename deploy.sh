#!/usr/bin/env bash
# ==============================================================================
# ProctorShield AI — 1-Command VPS Production Deployment Script
# ==============================================================================
set -e

echo "🛡️  Starting ProctorShield AI Deployment..."

# 1. Check for .env file
if [ ! -f ".env" ]; then
  echo "❌ Error: .env file not found. Please create .env with your database URL & API keys before deploying."
  exit 1
fi

# 2. Check Docker installation
if ! command -v docker &> /dev/null; then
  echo "📦 Docker not found. Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
  sudo usermod -aG docker $USER || true
  echo "✅ Docker installed successfully."
fi

# 3. Build & Run Containers with Docker Compose
echo "🚀 Building and launching Docker container..."
if docker compose version &> /dev/null; then
  docker compose down --remove-orphans || true
  docker compose up -d --build
else
  docker-compose down --remove-orphans || true
  docker-compose up -d --build
fi

echo "=============================================================================="
echo "🎉 ProctorShield AI is now LIVE on your VPS!"
echo "🌐 Access your application at: http://<YOUR_VPS_IP>:3000"
echo "📊 Check container logs with: docker logs -f proctorshieldai"
echo "=============================================================================="
