#!/usr/bin/env bash
set -euo pipefail

echo "Starting ProctorShield AI deployment..."

if [ ! -f ".env" ]; then
  echo "Error: .env is required. Create it from .env.example and supply production secrets."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install it from your operating system's trusted package source, then rerun this script."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  docker compose down --remove-orphans
  docker compose up -d --build
else
  docker-compose down --remove-orphans
  docker-compose up -d --build
fi

echo "Deployment completed. Verify HTTPS, health checks, logs, and the PayMongo webhook before accepting traffic."
