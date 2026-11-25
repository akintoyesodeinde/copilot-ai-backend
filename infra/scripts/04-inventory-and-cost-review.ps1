#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only AWS Sandbox resource inventory, CloudWatch alarm status, and monthly cost review.
#>
param(
  [string]$EnvironmentName = "sandbox",
  [string]$Region = "us-east-1"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
Write-Host "=== AWS Account $($identity.Account) ($Region) — CodePilot AI Inventory ===" -ForegroundColor Cyan

foreach ($suffix in @("01-network", "02-data", "03-compute", "04-budgets")) {
  $stackName = "codepilot-ai-$EnvironmentName-$suffix"
  $out = aws cloudformation describe-stacks --region $Region --stack-name $stackName --query "Stacks[0].[StackStatus,Outputs]" --output json 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "`nStack: $stackName" -ForegroundColor Green
    Write-Host $out
  } else {
    Write-Host "Stack: $stackName -> NOT DEPLOYED" -ForegroundColor DarkGray
  }
}

Write-Host "`n=== CloudWatch Alarms ===" -ForegroundColor Cyan
aws cloudwatch describe-alarms --region $Region --alarm-name-prefix "codepilot-ai-$EnvironmentName-" --query "MetricAlarms[*].[AlarmName,StateValue]" --output table

Write-Host "`n=== Month-to-Date AWS Spend (Cost Explorer) ===" -ForegroundColor Cyan
$start = (Get-Date -Day 1).ToString("yyyy-MM-dd")
$end = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
aws ce get-cost-and-usage --time-period "Start=$start,End=$end" --granularity MONTHLY --metrics BlendedCost --output table 2>$null
