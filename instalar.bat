@echo off
rem Instalador para Windows. De dois cliques ou rode: instalar.bat
cd /d "%~dp0"
where python >nul 2>nul || (echo Instale o Python 3.11+: winget install Python.Python.3.12 & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Instalando ffmpeg... & winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements)
where deno >nul 2>nul || (echo Instalando Deno, necessario para o YouTube... & winget install --id DenoLand.Deno -e --accept-source-agreements --accept-package-agreements)
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip -q
.venv\Scripts\python.exe -m pip install -r requirements.txt -q
echo.
echo Pronto! Feche e abra o terminal e use, dentro desta pasta:
echo    cortar ^<link-da-live^>
echo Para usar de qualquer pasta, adicione esta pasta ao PATH do Windows:
echo    %~dp0
pause
