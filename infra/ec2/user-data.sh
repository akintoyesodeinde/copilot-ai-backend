#!/usr/bin/env bash
# CodePilot AI — Idempotent EC2 Sandbox Deployment & Runtime Hydration Script
# Fetches runtime secrets securely from AWS SSM Parameter Store (never hardcoded in Git),
# pulls digest/SHA-pinned Docker Hub images, runs Prisma migrations, and verifies health checks.
set -euo pipefail

APP_DIR="/opt/codepilot-ai"
ENV_FILE="${APP_DIR}/.env.runtime"
META_FILE="${APP_DIR}/deployment.meta"

if [ ! -f "${META_FILE}" ]; then
  echo "ERROR: ${META_FILE} missing. Ensure EC2 Launch Template bootstrap ran." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${META_FILE}"

BACKEND_IMAGE="${1:-${DOCKERHUB_NAMESPACE}/codepilot-ai-backend:latest}"
WORKER_IMAGE="${2:-${DOCKERHUB_NAMESPACE}/codepilot-ai-worker:latest}"
FRONTEND_IMAGE="${3:-${DOCKERHUB_NAMESPACE}/codepilot-ai-frontend:latest}"

fetch_param() {
  local name="$1"
  local fallback="${2:-}"
  aws ssm get-parameter \
    --region "${AWS_REGION}" \
    --name "/codepilot-ai/${ENVIRONMENT_NAME}/${name}" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "${fallback}"
}

echo "[1/5] Hydrating runtime environment from AWS SSM Parameter Store (/codepilot-ai/${ENVIRONMENT_NAME}/*)..."
DB_USER="$(fetch_param db_username codepilot_admin)"
DB_PASS="$(fetch_param db_password)"
SESSION_SECRET="$(fetch_param session_secret)"
GITHUB_WEBHOOK_SECRET="$(fetch_param github_webhook_secret dev-webhook-placeholder)"
GITHUB_MODE="$(fetch_param github_mode fixture)"
AI_DEFAULT_PROVIDER="$(fetch_param ai_default_provider mock)"
OPENAI_API_KEY="$(fetch_param openai_api_key '')"
ANTHROPIC_API_KEY="$(fetch_param anthropic_api_key '')"

if [ -z "${DB_PASS}" ] || [ -z "${SESSION_SECRET}" ]; then
  echo "ERROR: Required SSM parameters (db_password, session_secret) are missing." >&2
  exit 1
fi

DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${RDS_ENDPOINT}:3306/codepilot_ai?ssl-mode=required"
PUBLIC_SCHEME="https"
APP_ORIGIN="${PUBLIC_SCHEME}://${APP_DOMAIN}"

umask 077
cat <<EOF > "${ENV_FILE}"
NODE_ENV=production
DATABASE_URL=${DATABASE_URL}
APP_URL=${APP_ORIGIN}
FRONTEND_ORIGIN=${APP_ORIGIN}
SESSION_SECRET=${SESSION_SECRET}
COOKIE_SECURE=true
GITHUB_MODE=${GITHUB_MODE}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
AI_DEFAULT_PROVIDER=${AI_DEFAULT_PROVIDER}
OPENAI_API_KEY=${OPENAI_API_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
AWS_REGION=${AWS_REGION}
SQS_QUEUE_URL=${SQS_QUEUE_URL}
SQS_DLQ_URL=${SQS_DLQ_URL}
S3_ARTIFACTS_BUCKET=${S3_ARTIFACTS_BUCKET}
BACKEND_IMAGE=${BACKEND_IMAGE}
WORKER_IMAGE=${WORKER_IMAGE}
FRONTEND_IMAGE=${FRONTEND_IMAGE}
EOF
chmod 600 "${ENV_FILE}"

# Generate self-signed TLS cert for sandbox IP/domain if Let's Encrypt cert not yet installed
if [ ! -f "${APP_DIR}/certs/fullchain.pem" ] || [ ! -f "${APP_DIR}/certs/privkey.pem" ]; then
  echo "[2/5] Generating initial TLS certificate for Nginx HTTPS termination..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${APP_DIR}/certs/privkey.pem" \
    -out "${APP_DIR}/certs/fullchain.pem" \
    -subj "/CN=${APP_DOMAIN}"
  chmod 600 "${APP_DIR}/certs/privkey.pem"
fi

echo "[3/5] Pulling pinned container images..."
docker pull "${BACKEND_IMAGE}"
docker pull "${WORKER_IMAGE}"
docker pull "${FRONTEND_IMAGE}"

echo "[4/5] Applying Prisma MySQL 8.4 migrations before container rollout..."
docker run --rm --env-file "${ENV_FILE}" "${WORKER_IMAGE}" npx prisma migrate deploy

echo "[5/5] Rolling out production Compose stack and verifying health checks..."
docker compose -f "${APP_DIR}/docker-compose.prod.yml" --env-file "${ENV_FILE}" up -d --remove-orphans

for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/v1/health/ready >/dev/null 2>&1; then
    echo "SUCCESS: Backend /api/v1/health/ready returned 200 OK."
    exit 0
  fi
  sleep 3
done

echo "ERROR: Backend readiness check failed after rollout." >&2
docker compose -f "${APP_DIR}/docker-compose.prod.yml" logs --tail=50 backend worker
exit 1
