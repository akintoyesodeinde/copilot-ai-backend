# CodePilot AI — AWS Sandbox Cost Estimation & Budget Guardrails

## 1. Honest Itemized Monthly Cost Estimate (`us-east-1`, On-Demand, No Free-Tier Assumptions)

To avoid misleading estimates, the table below uses standard AWS `us-east-1` on-demand list pricing assuming 730 hours/month continuous uptime (no AWS Free Tier credits assumed):

| AWS Service                        | Sizing / Configuration                                                        | Est. Monthly Cost (USD) |
| ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| **Amazon EC2**                     | `1 x t3.small` (2 vCPU, 2 GB RAM), Linux On-Demand (\$0.0208/hr x 730h)       | \$15.18                 |
| **Amazon EBS**                     | `30 GB gp3` encrypted root volume (\$0.08/GB-mo)                              | \$2.40                  |
| **Public IPv4 Address**            | `1 x Elastic IP` attached to EC2 (\$0.005/hr x 730h)                          | \$3.65                  |
| **Amazon RDS MySQL 8.4**           | `1 x db.t3.micro` Single-AZ On-Demand (\$0.017/hr x 730h)                     | \$12.41                 |
| **RDS Storage**                    | `20 GB gp3` encrypted + automated snapshots within allocation (\$0.115/GB-mo) | \$2.30                  |
| **Amazon S3 + SQS + CloudWatch**   | Private artifacts (<1 GB), <100k SQS requests, 14-day log retention           | ~\$1.50                 |
| **NAT Gateway / ALB / Multi-AZ**   | **Intentionally omitted** in sandbox (saves >\$55/month)                      | \$0.00                  |
| **Estimated Infrastructure Total** | **24/7 Sandbox Monthly Run Rate**                                             | **~\$37.44 / month**    |

> **AWS Budgets Hard Alert Cap:** CloudFormation Stack `04-budgets.yaml` configures a **\$40.00/month** AWS Budget with email alerts at **50% (\$20)**, **80% (\$32)**, **100% actual (\$40)**, and **100% forecasted (\$40)**.

## 2. Application-Level AI Spend Guardrails

In addition to AWS infrastructure budgets, CodePilot AI enforces strict multi-tenant AI spend caps inside MySQL (`usage_limits` + `ai_usage_records`):

- Default sandbox workspace limit: **\$25.00/month** and **2,000,000 tokens/month**.
- Requests projected to exceed either limit fail fast with `402 Payment Required` (`AI_BUDGET_EXCEEDED`) before contacting external AI providers.
- Default sandbox/CI provider is `mock` (\$0.00 external LLM spend) until an owner explicitly enables `openai`, `anthropic`, or `bedrock` in `workspace_settings.allowed_ai_providers_json`.

## 3. Immediate Cost-Control Actions

- Stop the EC2 instance and RDS instance when not actively demonstrating (reduces monthly run rate below \$8/month for storage + EIP).
- Run `.\infra\scripts\05-teardown-sandbox.ps1 -ConfirmTeardown` to remove all stacks and halt recurring infrastructure charges completely.
