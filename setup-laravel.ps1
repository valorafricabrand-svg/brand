<#
  setup-laravel.ps1
  Helper script to scaffold a Laravel project in a `backend` directory.
  This script attempts to run `composer create-project` if Composer is available.

  Usage (PowerShell):
    .\setup-laravel.ps1

  The script will:
  - Check PHP version (require >= 8.1)
  - Check Composer availability
  - Run `composer create-project --prefer-dist laravel/laravel backend`
  - Provide next steps to finish setup (copy .env, set APP_URL, run migrations)
#>

function Write-Note($msg){ Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[error] $msg" -ForegroundColor Red }

Write-Note "Checking PHP..."
$php = & php -v 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warn "PHP not found in PATH. Install PHP 8.1+ and ensure `php` is on your PATH."
} else {
  Write-Note "PHP detected:"; Write-Host $php
}

Write-Note "Checking Composer..."
$composer = & composer -V 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warn "Composer not found. Please install Composer for Windows: https://getcomposer.org/"
  Write-Note "You can still run the following command once Composer is installed:"
  Write-Host "composer create-project --prefer-dist laravel/laravel backend"
  exit 0
} else {
  Write-Note "Composer detected:"; Write-Host $composer
}

if (Test-Path -Path "backend") {
  Write-Warn "A 'backend' folder already exists. Skipping project creation."
  Write-Note "If you want to recreate, remove or rename the existing 'backend' folder first."
  exit 0
}

Write-Note "Creating Laravel project in .\backend (this may take a few minutes)..."
& composer create-project --prefer-dist laravel/laravel backend

if ($LASTEXITCODE -ne 0) {
  Write-Err "composer create-project failed. See output above."
  exit $LASTEXITCODE
}

Write-Note "Laravel project created. Next steps:"
Write-Host "  cd backend"
Write-Host "  copy .env.example .env"
Write-Host "  (edit .env: set APP_URL=http://localhost:8000 and your DB settings)"
Write-Host "  php artisan key:generate"
Write-Host "  php artisan migrate --seed"
Write-Host "  php artisan serve --host=127.0.0.1 --port=8000"

Write-Note "If you prefer to serve via Valet or a local webserver, configure your virtual host accordingly."
