@echo off
title Catalogo Digital - Bebidas 25 de Mayo
chcp 65001 > nul
cls

echo =======================================================
echo    INICIANDO CATALOGO DIGITAL - BEBIDAS 25 DE MAYO
echo =======================================================
echo.

set PYTHON_CMD=python
where python >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else if exist "%PROGRAMFILES%\Python312\python.exe" (
        set PYTHON_CMD="%PROGRAMFILES%\Python312\python.exe"
    ) else (
        echo [ERROR] No se encontro Python instalado en el sistema.
        echo Por favor instala Python 3.10 o superior para ejecutar la aplicacion.
        pause
        exit /b 1
    )
)

echo [1/2] Verificando dependencias...
%PYTHON_CMD% -m pip install -r requirements.txt --quiet

echo [2/2] Iniciando servidor y abriendo navegador web...
echo.
echo Para cerrar la aplicacion, presiona Ctrl+C o cierra esta ventana.
echo =======================================================
echo.

%PYTHON_CMD% app.py

pause
