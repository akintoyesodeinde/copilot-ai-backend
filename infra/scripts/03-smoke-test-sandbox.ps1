#Requires -Version 5.1
<#
.SYNOPSIS
  Executes live smoke checks against a deployed CodePilot AI Sandbox endpoint.
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$cleanUrl = $BaseUrl.TrimEnd('/')
Write-Host "Running smoke checks against $cleanUrl ..." -ForegroundColor Cyan

$live = Invoke-RestMethod -Uri "$cleanUrl/api/v1/health/live" -Method Get
Write-Host "[OK] /api/v1/health/live  -> $($live | ConvertTo-Json -Compress)" -ForegroundColor Green

$ready = Invoke-RestMethod -Uri "$cleanUrl/api/v1/health/ready" -Method Get
Write-Host "[OK] /api/v1/health/ready -> $($ready | ConvertTo-Json -Compress)" -ForegroundColor Green

$openapi = Invoke-RestMethod -Uri "$cleanUrl/api/v1/openapi.json" -Method Get
$pathCount = ($openapi.paths | Get-Member -MemberType NoteProperty).Count
Write-Host "[OK] /api/v1/openapi.json -> $pathCount documented OpenAPI 3.1 endpoints" -ForegroundColor Green

$homeResp = Invoke-WebRequest -Uri "$cleanUrl/" -Method Get -UseBasicParsing
if ($homeResp.StatusCode -ne 200) { throw "Frontend homepage returned HTTP $($homeResp.StatusCode)" }
Write-Host "[OK] Frontend landing page returned HTTP 200" -ForegroundColor Green
