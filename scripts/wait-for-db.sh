#!/usr/bin/env bash
set -e

CONTAINER="jobs-postgres"
TIMEOUT=30

echo "Waiting for Postgres ($CONTAINER) to be healthy..."

for i in $(seq 1 $TIMEOUT); do
  # Try docker health status
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "no-container")
  
  if [ "$STATUS" = "healthy" ]; then
    echo "✓ Postgres is healthy (after ${i}s)"
    exit 0
  fi

  # Fallback: try pg_isready via exec if container exists but no healthcheck yet
  if [ "$STATUS" != "no-container" ] && [ "$STATUS" != "starting" ] && [ "$STATUS" != "healthy" ]; then
    # if health is unhealthy, still try pg_isready
    if docker exec "$CONTAINER" pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-jobs}" >/dev/null 2>&1; then
      echo "✓ Postgres is ready via pg_isready (after ${i}s)"
      exit 0
    fi
  fi

  if [ "$STATUS" = "no-container" ]; then
    echo "  container not found yet ($i/${TIMEOUT})..."
  else
    echo "  status=$STATUS ($i/${TIMEOUT})..."
  fi

  sleep 1
done

echo "✗ Postgres not healthy after ${TIMEOUT}s"
echo "--- docker ps ---"
docker ps 2>&1 || true
echo "--- logs tail ---"
docker logs "$CONTAINER" --tail 50 2>&1 || true
exit 1
