#Requires -Version 5.1
<#
.SYNOPSIS
    kassar-agent installer for Windows
.DESCRIPTION
    Clones and installs kassar-agent as a Windows Service.
    Run as Administrator in PowerShell.
.EXAMPLE
    powershell -c "irm https://kassar-agent.replit.app/install.ps1 | iex"
#>

# Fix encoding FIRST - before any output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding            = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$ErrorActionPreference = "Continue"

# --- Config -------------------------------------------------------------------
$AGENT_NAME    = "kassar-agent"
$AGENT_VERSION = "1.0.0"
$REPO_URL      = "https://github.com/IbrahimAbdAlrasol-SS/kassar-agent.git"
$INSTALL_DIR   = "$env:LOCALAPPDATA\kassar-agent"
$SRC_DIR       = "$INSTALL_DIR\src"
$BIN_DIR       = "$INSTALL_DIR\bin"
$MEMORY_DIR    = "$INSTALL_DIR\memory"
$LOGS_DIR      = "$INSTALL_DIR\logs"
$WORKSPACE_DIR = "$INSTALL_DIR\workspace"
$CONFIG_FILE   = "$INSTALL_DIR\config.json"
$CMD_FILE      = "$BIN_DIR\kassar.cmd"
$SERVICE_NAME  = "KassarAgent"
$NODE_MIN_VER  = 20

# --- Output helpers -----------------------------------------------------------
function Write-Step   { param($msg) Write-Host "  >> $msg" -ForegroundColor Cyan    }
function Write-Ok     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green  }
function Write-Fail   { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Red    }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Header { param($msg) Write-Host "`n  === $msg ===" -ForegroundColor White }

# --- Banner -------------------------------------------------------------------
Clear-Host
Write-Host ""
Write-Host "  +-------------------------------------------------+" -ForegroundColor Blue
Write-Host "  |                                                 |" -ForegroundColor Blue
Write-Host "  |   :::    :::  :::      ::::::::  ::::::::      |" -ForegroundColor Blue
Write-Host "  |   :+:   :+:  :+:     :+:    :+: :+:    :+:    |" -ForegroundColor Blue
Write-Host "  |   +:+  +:+   +:+     +:+    +:+ +:+    +:+     |" -ForegroundColor Blue
Write-Host "  |   +#++:++    +#+     +#+    +:+ +#++:++#:      |" -ForegroundColor Blue
Write-Host "  |   +#+  +#+   +#+     +#+    +#+ +#+    +#+     |" -ForegroundColor Blue
Write-Host "  |   #+#   #+#  #+#     #+#    #+# #+#    #+#    |" -ForegroundColor Blue
Write-Host "  |   ###    ### ######   ########  ###    ###     |" -ForegroundColor Blue
Write-Host "  |                                                 |" -ForegroundColor Blue
Write-Host "  +-------------------------------------------------+" -ForegroundColor Blue
Write-Host ""
Write-Host "  kassar-agent v$AGENT_VERSION -- Autonomous AI Agent" -ForegroundColor White
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# --- Admin check --------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "This installer requires Administrator privileges."
    Write-Host ""
    Write-Host "  Right-click PowerShell and choose 'Run as Administrator'," -ForegroundColor Yellow
    Write-Host "  then run this command again:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  powershell -c `"irm https://kassar-agent.replit.app/install.ps1 | iex`"" -ForegroundColor White
    Write-Host ""
    exit 1
}

# --- Node.js check ------------------------------------------------------------
Write-Header "Checking prerequisites"

try {
    $nodeVersion = (node --version 2>&1).ToString().TrimStart("v")
    $nodeMajor   = [int]($nodeVersion.Split(".")[0])
    if ($nodeMajor -lt $NODE_MIN_VER) {
        Write-Fail "Node.js v$NODE_MIN_VER+ required. Found: v$nodeVersion"
        Write-Host ""
        Write-Host "  Download Node.js from: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "Node.js v$nodeVersion"
} catch {
    Write-Fail "Node.js not found."
    Write-Host ""
    Write-Host "  Download Node.js (v$NODE_MIN_VER+) from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# --- Git check ----------------------------------------------------------------
try {
    $gitVersion = (git --version 2>&1).ToString()
    Write-Ok "Git: $gitVersion"
} catch {
    Write-Fail "Git not found."
    Write-Host ""
    Write-Host "  Download Git from: https://git-scm.com/download/win" -ForegroundColor Yellow
    exit 1
}

# --- Create directories -------------------------------------------------------
Write-Header "Creating directories"

foreach ($dir in @($INSTALL_DIR, $BIN_DIR, $MEMORY_DIR, $LOGS_DIR, $WORKSPACE_DIR)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Ok "Created: $dir"
    } else {
        Write-Step "Exists:  $dir"
    }
}

# --- Clone or update repo -----------------------------------------------------
Write-Header "Downloading kassar-agent source"

$ProgressPreference = "SilentlyContinue"

if (Test-Path "$SRC_DIR\.git") {
    Write-Step "Source exists, pulling latest changes..."
    try {
        Set-Location $SRC_DIR
        git pull --quiet 2>&1 | Out-Null
        Write-Ok "Updated to latest version"
    } catch {
        Write-Warn "Could not pull updates -- using existing version"
    }
} else {
    Write-Step "Cloning from GitHub..."
    try {
        if (Test-Path $SRC_DIR) {
            Remove-Item $SRC_DIR -Recurse -Force
        }
        git clone --depth 1 --quiet $REPO_URL $SRC_DIR 2>&1 | Out-Null
        Write-Ok "Cloned to $SRC_DIR"
    } catch {
        Write-Fail "Clone failed: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "  Make sure you have internet access and Git is working." -ForegroundColor Yellow
        Write-Host "  Repo: $REPO_URL" -ForegroundColor Cyan
        exit 1
    }
}

# --- Install dependencies -----------------------------------------------------
Write-Header "Installing dependencies"

Set-Location $SRC_DIR
Write-Step "Running npm install (this may take a minute)..."
cmd /c "npm install"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install failed (exit code: $LASTEXITCODE)"
    exit 1
}
Write-Ok "Dependencies installed"

# --- Create kassar.cmd launcher -----------------------------------------------
Write-Header "Creating launcher"

$nodeCmd  = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { "node" }

$tsxPath    = "$SRC_DIR\node_modules\.bin\tsx.cmd"
$cliEntry   = "$SRC_DIR\cli\index.ts"

# Prefer tsx if available, fallback to compiled js
if (Test-Path $tsxPath) {
    $launchCmd = "`"$tsxPath`" `"$cliEntry`""
} else {
    # Build first, then use compiled output
    Write-Step "Building TypeScript..."
    Set-Location $SRC_DIR
    cmd /c "npm run build"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "TypeScript build failed"
        exit 1
    }
    $launchCmd = "`"$nodePath`" `"$SRC_DIR\dist\cli\index.js`""
    Write-Ok "Built successfully"
}

$cmdContent = "@echo off`r`n$launchCmd %*`r`n"
[System.IO.File]::WriteAllText($CMD_FILE, $cmdContent, [System.Text.Encoding]::ASCII)
Write-Ok "Launcher created: $CMD_FILE"

# --- Add to PATH --------------------------------------------------------------
Write-Header "Configuring PATH"

$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$BIN_DIR", "User")
    $env:PATH = "$env:PATH;$BIN_DIR"
    Write-Ok "Added $BIN_DIR to PATH"
} else {
    Write-Step "$BIN_DIR already in PATH"
}

# --- Initial config -----------------------------------------------------------
Write-Header "Creating initial configuration"

# --- Ask for OpenAI API key ---------------------------------------------------
Write-Header "OpenAI API Key"
Write-Host "  Get your key from: https://platform.openai.com/api-keys" -ForegroundColor Cyan
Write-Host ""

$OPENAI_KEY = ""
$OPENAI_KEY_RAW = Read-Host "  Enter your OpenAI API key (sk-...) [press Enter to skip]"
if ($OPENAI_KEY_RAW -match "^sk-") {
    $OPENAI_KEY = $OPENAI_KEY_RAW.Trim()
    Write-Ok "API key accepted"
} elseif ($OPENAI_KEY_RAW.Length -gt 0) {
    Write-Warn "Key format looks wrong (should start with sk-). You can set it later:"
    Write-Warn "  kassar config set model.apiKey sk-..."
} else {
    Write-Warn "Skipped. Set it later with: kassar config set model.apiKey sk-..."
}

if (-not (Test-Path $CONFIG_FILE)) {
    $defaultConfig = @{
        agent = @{
            name         = "kassar-agent"
            version      = $AGENT_VERSION
            maxRetries   = 3
            retryDelayMs = 1000
        }
        logging = @{
            level    = "info"
            file     = "$LOGS_DIR\app.log"
            maxSize  = "10m"
            maxFiles = 5
        }
        workspace = @{ dir = $WORKSPACE_DIR }
        telegram  = @{ botToken = ""; chatId = "" }
        model     = @{
            provider            = "openai"
            apiKey              = $OPENAI_KEY
            model               = "gpt-4o-mini"
            baseURL             = "https://api.openai.com/v1"
            maxCompletionTokens = 1280
        }
        service   = @{
            name        = $SERVICE_NAME
            displayName = "Kassar Agent"
            autoStart   = $true
        }
    }
    $defaultConfig | ConvertTo-Json -Depth 5 | Set-Content $CONFIG_FILE -Encoding UTF8
    Write-Ok "Config created: $CONFIG_FILE"
} else {
    Write-Step "Config exists: $CONFIG_FILE"
    # Update the API key in existing config if provided
    if ($OPENAI_KEY.Length -gt 0) {
        $existingCfg = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
        if (-not $existingCfg.model) {
            $existingCfg | Add-Member -NotePropertyName model -NotePropertyValue ([PSCustomObject]@{
                provider            = "openai"
                apiKey              = $OPENAI_KEY
                model               = "gpt-4o-mini"
                baseURL             = "https://api.openai.com/v1"
                maxCompletionTokens = 1280
            })
        } else {
            $existingCfg.model.apiKey = $OPENAI_KEY
        }
        $existingCfg | ConvertTo-Json -Depth 5 | Set-Content $CONFIG_FILE -Encoding UTF8
        Write-Ok "API key saved to config.json"
    }
}

# --- Install Windows Service --------------------------------------------------
Write-Header "Installing Windows Service"

# Remove any stale/broken existing service first
$existing = sc.exe query $SERVICE_NAME 2>&1
if ($existing -notlike "*FAILED*") {
    Write-Step "Removing old service registration..."
    sc.exe stop $SERVICE_NAME 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    sc.exe delete $SERVICE_NAME 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    Write-Step "Old service removed"
}

# Use CLI to install (builds correct node.exe + tsx binPath)
Write-Step "Registering Windows Service via kassar CLI..."
cmd /c "`"$CMD_FILE`" service install"
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Service '$SERVICE_NAME' installed (auto-start on boot)"
    Write-Step "Starting service..."
    cmd /c "`"$CMD_FILE`" service start"
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Service '$SERVICE_NAME' started"
    } else {
        Write-Warn "Service installed but could not auto-start -- run: kassar service start"
    }
} else {
    Write-Warn "Service install failed -- run manually: kassar service install"
}

# --- Verify kassar command ----------------------------------------------------
Write-Header "Verifying installation"

try {
    $ver = & "$CMD_FILE" --version 2>&1
    Write-Ok "kassar command works: $ver"
} catch {
    Write-Warn "Could not verify kassar command -- open a new terminal and try: kassar --version"
}

# --- Done ---------------------------------------------------------------------
Write-Host ""
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to: $INSTALL_DIR" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Next steps (open a NEW terminal window first):" -ForegroundColor White
if ($OPENAI_KEY.Length -eq 0) {
Write-Host "    1. Set OpenAI key:   kassar openai connect" -ForegroundColor Yellow
} else {
Write-Host "    1. OpenAI key: already set" -ForegroundColor Green
}
Write-Host "    2. Set Telegram bot: kassar telegram connect" -ForegroundColor Cyan
Write-Host "    3. Check setup:      kassar doctor" -ForegroundColor Cyan
Write-Host "    4. Start the agent:  kassar start" -ForegroundColor Cyan
Write-Host "    5. Open dashboard:   kassar dashboard" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Config file: $CONFIG_FILE" -ForegroundColor DarkGray
Write-Host "  Docs:        https://kassar-agent.replit.app" -ForegroundColor DarkGray
Write-Host ""
