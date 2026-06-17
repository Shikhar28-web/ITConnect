@echo off
echo ================================================
echo   ITComputer Remote Support System - Setup
echo ================================================
echo.

echo [1/4] Checking prerequisites...

where dotnet >nul 2>&1
if errorlevel 1 (
    echo ERROR: .NET SDK not found. Install from https://dot.net
    pause & exit /b 1
)
echo    .NET SDK: OK

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)
echo    Node.js: OK

echo.
echo [2/4] Setting up backend...
cd server
dotnet restore ITComputer.sln
if errorlevel 1 (echo ERROR: dotnet restore failed & pause & exit /b 1)
echo    Backend packages restored.

echo.
echo [3/4] Setting up Agent...
cd ..\agent
npm install
if errorlevel 1 (echo ERROR: npm install failed in agent & pause & exit /b 1)
echo    Agent packages installed.

echo.
echo [4/4] Setting up Admin Console...
cd ..\console
npm install
if errorlevel 1 (echo ERROR: npm install failed in console & pause & exit /b 1)
echo    Console packages installed.

echo.
echo ================================================
echo   Setup Complete!
echo ================================================
echo.
echo Next steps:
echo   1. Edit server\ITComputer.API\appsettings.json
echo      and set your SQL Server connection string.
echo.
echo   2. Start the server:
echo      cd server\ITComputer.API
echo      dotnet run
echo.
echo   3. Start the Agent (on employee machines):
echo      cd agent
echo      npm run electron:dev
echo.
echo   4. Start the Console (on IT machines):
echo      cd console
echo      npm run electron:dev
echo.
echo   Default admin: admin / Admin@123!
echo   Swagger:       http://localhost:5000/swagger
echo.
pause
