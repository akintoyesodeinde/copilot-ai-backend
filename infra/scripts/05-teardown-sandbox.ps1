#Requires -Version 5.1
<#
.SYNOPSIS
  Safely tears down all CodePilot AI AWS Sandbox stacks in reverse order to halt recurring charges.
  Requires explicit -ConfirmTeardown switch.
#>
param(
  [string]$EnvironmentName = "sandbox",
  [string]$Region = "us-east-1",
  [switch]$ConfirmTeardown
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ConfirmTeardown) {
  Write-Host "SAFETY GUARD: Pass -ConfirmTeardown to delete CodePilot AI sandbox stacks ($EnvironmentName in $Region)." -ForegroundColor Yellow
  exit 0
}

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$bucket = "codepilot-ai-$EnvironmentName-artifacts-$($identity.Account)-$Region"
Write-Host "Emptying S3 artifacts bucket $bucket (if present)..." -ForegroundColor Cyan
aws s3 rm "s3://$bucket" --recursive --region $Region 2>$null | Out-Null

foreach ($suffix in @("04-budgets", "03-compute", "02-data", "01-network")) {
  $stackName = "codepilot-ai-$EnvironmentName-$suffix"
  Write-Host "Deleting stack $stackName ..." -ForegroundColor Cyan
  aws cloudformation delete-stack --region $Region --stack-name $stackName
  aws cloudformation wait stack-delete-complete --region $Region --stack-name $stackName
  Write-Host "  [DELETED] $stackName" -ForegroundColor Green
}

Write-Host "`nAll CodePilot AI sandbox resources have been cleaned up." -ForegroundColor Green
