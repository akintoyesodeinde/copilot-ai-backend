#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only AWS CLI verification & CloudFormation template validation for CodePilot AI Sandbox.
  Creates ZERO AWS resources.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== 1. Verifying AWS CLI Installation & Caller Identity ===" -ForegroundColor Cyan
aws --version
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$region = aws configure get region
if (-not $region) { $region = "us-east-1" }

Write-Host "Authenticated Account : $($identity.Account)"
Write-Host "Authenticated ARN     : $($identity.Arn)"
Write-Host "Target AWS Region     : $region"

Write-Host "`n=== 2. Validating All CloudFormation Templates (Read-Only) ===" -ForegroundColor Cyan
$templateDir = Join-Path $PSScriptRoot "..\cloudformation"
$templates = Get-ChildItem -Path $templateDir -Filter "*.yaml" | Sort-Object Name

foreach ($tpl in $templates) {
  Write-Host "Validating $($tpl.Name)..."
  aws cloudformation validate-template --region $region --template-body "file://$($tpl.FullName)" --output json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "CloudFormation validation failed for $($tpl.Name)"
  }
  Write-Host "  [OK] $($tpl.Name)" -ForegroundColor Green
}

Write-Host "`nAll 4 CloudFormation templates validated successfully against AWS ($region)." -ForegroundColor Green
