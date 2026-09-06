# Arsist Unity ビルド実行スクリプト
# 環境変数を設定してビルドを実行

param(
    [string]$UnityPath = "",
    [string]$ProjectPath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Arsist Unity Build" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# Unity.exeのパスを自動検出または設定
if (-not $UnityPath) {
    Write-Host "`n[1/4] Detecting Unity..." -ForegroundColor Yellow
    
    # 既存の環境変数をチェック
    if ($env:ARSIST_UNITY_PATH) {
        $UnityPath = $env:ARSIST_UNITY_PATH
        Write-Host "✅ Using ARSIST_UNITY_PATH: $UnityPath" -ForegroundColor Green
    } else {
        # Unity Hub のインストール先を、バージョンに依存せず走査する
        # (このプロジェクトは ProjectVersion.txt でピン留めした Unity 6000.x を使うため、
        #  2022/2023 固定の glob では検出できなかった)
        $hubRoots = @(
            (Join-Path $env:ProgramFiles "Unity\Hub\Editor"),
            (Join-Path ${env:ProgramFiles(x86)} "Unity\Hub\Editor")
        )

        foreach ($root in $hubRoots) {
            if (-not $root -or -not (Test-Path $root)) { continue }
            # 新しいバージョン順（辞書順降順）で最初に見つかった Unity.exe を採用
            $versionDirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($dir in $versionDirs) {
                $candidate = Join-Path $dir.FullName "Editor\Unity.exe"
                if (Test-Path $candidate) {
                    $UnityPath = $candidate
                    Write-Host "✅ Auto-detected: $UnityPath" -ForegroundColor Green
                    break
                }
            }
            if ($UnityPath) { break }
        }
    }
}

if (-not $UnityPath -or -not (Test-Path $UnityPath)) {
    Write-Host "❌ Unity.exe not found!" -ForegroundColor Red
    Write-Host "Please specify Unity path:" -ForegroundColor Yellow
    Write-Host '  .\run-build.ps1 -UnityPath "C:\Program Files\Unity\Hub\Editor\2022.3.x\Editor\Unity.exe"' -ForegroundColor White
    Write-Host "Or set environment variable:" -ForegroundColor Yellow
    Write-Host '  $env:ARSIST_UNITY_PATH = "C:\...\Unity.exe"' -ForegroundColor White
    exit 1
}

# 出力パスの設定
if (-not $OutputPath) {
    Write-Host "`n[2/4] Setting output path..." -ForegroundColor Yellow
    
    if ($env:ARSIST_OUTPUT_PATH) {
        $OutputPath = $env:ARSIST_OUTPUT_PATH
    } else {
        $OutputPath = Join-Path $PSScriptRoot "BuildOutput"
    }
    
    Write-Host "✅ Output: $OutputPath" -ForegroundColor Green
}

# プロジェクトパスの設定（テスト用のダミープロジェクトを作成）
if (-not $ProjectPath) {
    Write-Host "`n[3/4] Setting project path..." -ForegroundColor Yellow
    
    if ($env:ARSIST_PROJECT_PATH) {
        $ProjectPath = $env:ARSIST_PROJECT_PATH
    } else {
        # テスト用のダミープロジェクトを作成
        $ProjectPath = Join-Path $PSScriptRoot "TestProject"
        
        if (-not (Test-Path $ProjectPath)) {
            Write-Host "Creating test project..." -ForegroundColor Gray
            New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null
            
            # 最小限のproject.jsonを作成
            $testProject = @{
                id = "test-project-001"
                name = "Test AR App"
                version = "1.0.0"
                appType = "ar"
                targetDevice = "XREAL_One"
                arSettings = @{
                    trackingMode = "6dof"
                    presentationMode = "world_anchored"
                    floatingScreen = @{
                        distance = 2.0
                    }
                }
                uiAuthoring = @{
                    mode = "visual"
                }
                scenes = @(
                    @{
                        name = "MainScene"
                        objects = @()
                    }
                )
                buildSettings = @{
                    packageName = "com.test.arapp"
                    productName = "Test AR App"
                }
            }
            
            $testProject | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $ProjectPath "project.json") -Encoding UTF8
            Write-Host "✅ Created test project at: $ProjectPath" -ForegroundColor Green
        } else {
            Write-Host "✅ Using existing project: $ProjectPath" -ForegroundColor Green
        }
    }
}

# プロジェクトの検証
if (-not (Test-Path (Join-Path $ProjectPath "project.json"))) {
    Write-Host "❌ Invalid project: project.json not found" -ForegroundColor Red
    Write-Host "Project path: $ProjectPath" -ForegroundColor Yellow
    exit 1
}

# 出力ディレクトリを作成
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

# 環境変数を設定
$env:ARSIST_UNITY_PATH = $UnityPath
$env:ARSIST_OUTPUT_PATH = $OutputPath
$env:ARSIST_PROJECT_PATH = $ProjectPath

Write-Host "`n[4/4] Starting Unity build..." -ForegroundColor Yellow
Write-Host "Unity: $UnityPath" -ForegroundColor Gray
Write-Host "Project: $ProjectPath" -ForegroundColor Gray
Write-Host "Output: $OutputPath" -ForegroundColor Gray
Write-Host ""

# TypeScriptがビルドされているか確認
$distMain = Join-Path $PSScriptRoot "dist" "main" "main" "main.js"
if (-not (Test-Path $distMain)) {
    Write-Host "TypeScript not compiled. Running 'npm run build'..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ TypeScript compilation failed" -ForegroundColor Red
        exit 1
    }
}

# ビルド実行
Write-Host "Executing: node scripts/run-unity-build.js" -ForegroundColor Cyan
Write-Host ""

node (Join-Path $PSScriptRoot "scripts" "run-unity-build.js")

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n==================================" -ForegroundColor Green
    Write-Host "✅ Build Success!" -ForegroundColor Green
    Write-Host "==================================" -ForegroundColor Green
    Write-Host "APK location: $OutputPath" -ForegroundColor White
} else {
    Write-Host "`n==================================" -ForegroundColor Red
    Write-Host "❌ Build Failed" -ForegroundColor Red
    Write-Host "==================================" -ForegroundColor Red
    Write-Host "Check logs at: $OutputPath\unity_build.log" -ForegroundColor Yellow
    exit 1
}
