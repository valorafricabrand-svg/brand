@echo off
REM Windows helper to run Composer create-project for Laravel
IF EXIST backend (
  echo backend folder already exists. Remove it first if you want to recreate.
  exit /b 1
)
composer create-project --prefer-dist laravel/laravel backend
IF %ERRORLEVEL% NEQ 0 (
  echo Composer create-project failed. Make sure Composer is installed and in PATH.
  exit /b %ERRORLEVEL%
)
echo Laravel project created in backend\
echo Next: cd backend && copy .env.example .env && php artisan key:generate
