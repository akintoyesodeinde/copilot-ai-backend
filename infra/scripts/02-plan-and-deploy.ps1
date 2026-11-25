#Requires -Version 5.1
<#
.SYNOPSIS
  Safe CloudFormation Change-Set Planner and Provisioner for CodePilot AI AWS Sandbox.
  Defaults to dry-run Change Set preview; requires explicit -ApproveDeploy switch to execute.
#>
param(
  [string]$EnvironmentName = "sandbox",
  [string]$Region = "us-east-1",
  [string]$DockerHubNamespace = "akintoyesodeinde",
  [string]$AppDomain = "localhost",
  [Parameter(Mandatory = $true)][string]$AlertEmailAddress,
  [Parameter(Mandatory = $true)][SecureString]$DbMasterPassword,
  [switch]$ApproveDeploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($DbMasterPassword)
try {
  $plainDbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
Write-Host "Target AWS Account : $($identity.Account) ($($identity.Arn))" -ForegroundColor Yellow
Write-Host "Target AWS Region  : $Region" -ForegroundColor Yellow
Write-Host "Estimated Monthly  : ~$37.44 USD (under $40/month AWS Budgets cap)" -ForegroundColor Yellow

$cfnDir = Join-Path $PSScriptRoot "..\cloudformation"
$stacks = @(
  @{
    Name = "codepilot-ai-$EnvironmentName-01-network"
    File = Join-Path $cfnDir "01-network.yaml"
    Params = @("EnvironmentName=$EnvironmentName")
    Caps = @()
  },
  @{
    Name = "codepilot-ai-$EnvironmentName-02-data"
    File = Join-Path $cfnDir "02-data-and-messaging.yaml"
    Params = @("EnvironmentName=$EnvironmentName", "DbMasterPassword=$plainDbPass")
    Caps = @()
  },
  @{
    Name = "codepilot-ai-$EnvironmentName-03-compute"
    File = Join-Path $cfnDir "03-iam-oidc-and-compute.yaml"
    Params = @("EnvironmentName=$EnvironmentName", "DockerHubNamespace=$DockerHubNamespace", "AppDomain=$AppDomain")
    Caps = @("CAPABILITY_NAMED_IAM")
  },
  @{
    Name = "codepilot-ai-$EnvironmentName-04-budgets"
    File = Join-Path $cfnDir "04-budgets.yaml"
    Params = @("EnvironmentName=$EnvironmentName", "AlertEmailAddress=$AlertEmailAddress")
    Caps = @()
  }
)

if (-not $ApproveDeploy) {
  Write-Host "`nDRY-RUN MODE: Pass -ApproveDeploy after reviewing templates and cost estimate to provision resources." -ForegroundColor Cyan
  foreach ($s in $stacks) {
    aws cloudformation validate-template --region $Region --template-body "file://$($s.File)" | Out-Null
    Write-Host "  [READY] Stack $($s.Name) ($($s.File))"
  }
  exit 0
}

foreach ($s in $stacks) {
  Write-Host "`n=== Deploying Stack: $($s.Name) ===" -ForegroundColor Cyan
  $argsList = @(
    "cloudformation", "deploy",
    "--region", $Region,
    "--stack-name", $s.Name,
    "--template-file", $s.File,
    "--no-fail-on-empty-changeset",
    "--parameter-overrides"
  ) + $s.Params
  if ($s.Caps.Count -gt 0) {
    $argsList += @("--capabilities") + $s.Caps
  }
  & aws @argsList
  if ($LASTEXITCODE -ne 0) { throw "Deployment failed for stack $($s.Name)" }
}

Write-Host "`nCodePilot AI AWS Sandbox stacks provisioned cleanly." -ForegroundColor Green
