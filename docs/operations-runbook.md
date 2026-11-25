# CodePilot AI — Operations & Incident Response Runbook

## 1. Routine Health Verification

- **Liveness:** `GET /api/v1/health/live` (process up, returns `200 OK`).
- **Readiness:** `GET /api/v1/health/ready` (executes live `SELECT 1` against MySQL 8.4, returns `200 OK` or `503 Service Unavailable`).
- **Worker Health:** Inspect CloudWatch `/codepilot-ai/sandbox/worker` logs and CloudWatch Alarm `codepilot-ai-sandbox-sqs-dlq-nonempty`.

## 2. Accessing the EC2 Host (Zero SSH)

Use AWS Systems Manager Session Manager exclusively:

```bash
aws ssm start-session --target <EC2_INSTANCE_ID> --region us-east-1
```

## 3. Incident Playbooks

### A. Dead-Letter Queue (DLQ) Non-Empty Alarm

1. Inspect `analysis_jobs` where `status = 'DEAD_LETTERED'` and `job_attempts` for root `error_code` and `error_message`.
2. Resolve underlying fault (e.g., invalid GitHub App token, AI provider outage, malformed repository state).
3. Re-trigger job safely via API (idempotency keys prevent duplicate side effects) or purge poison messages from SQS DLQ.

### B. Stale Locked Jobs After Worker Crash

- The worker automatically runs `recoverStaleJobs()` on every poll tick, unlocking any `RUNNING` job whose `locked_until` heartbeat window has expired and returning it to `QUEUED` (or `DEAD_LETTERED` if `attempts >= max_attempts`).

### C. Secret Rotation (`SESSION_SECRET`, RDS Password, GitHub Webhook Secret)

1. Update the encrypted `SecureString` parameter under `/codepilot-ai/sandbox/*` in AWS SSM Parameter Store.
2. Re-run `/opt/codepilot-ai/user-data.sh` via SSM `SendCommand` to re-hydrate `.env.runtime` and restart containers cleanly.
3. Rotating `SESSION_SECRET` immediately invalidates existing sessions cleanly without database corruption.

### D. Database Backup & Point-in-Time Restore

- RDS MySQL 8.4 retains 7 days of automated snapshots (`BackupRetentionPeriod: 7`) plus final snapshots (`DeletionPolicy: Snapshot`).
- Restore to a new RDS instance in the private DB subnet group, verify with `npx prisma migrate status`, and update `RDS_ENDPOINT` in `/opt/codepilot-ai/deployment.meta`.

### E. Container Rollback

1. Look up the previous verified immutable image digest/tag (`sha-<prev>`) from the GitHub Actions release manifest artifact.
2. Execute `/opt/codepilot-ai/user-data.sh <backend_prev> <worker_prev> <frontend_prev>` via SSM.
3. Confirm `/api/v1/health/ready` returns `200 OK`.
