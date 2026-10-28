@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   ACTUALIZANDO TIENDA WEB - BEBIDAS 25 DE MAYO
echo ========================================================
echo.
echo [1/2] Generando catalogo actualizado y paquete tienda_cloudflare.zip...
python -c "import app; app.export_static_web_files(); print('Paquete tienda_cloudflare.zip generado con exito!')"
echo.
echo [2/2] Subiendo cambios a GitHub (si pide iniciar sesion, acepta en la ventana)...
git add index.html _headers _redirects api/public uploads static templates catalogo.db
git commit -m "Actualizacion catalogo web" 2>nul
git push origin main
echo.
echo ========================================================
echo   LISTO! Tambien tenes el archivo tienda_cloudflare.zip
echo   en esta carpeta por si queres arrastrarlo directo a
echo   https://dash.cloudflare.com (Workers and Pages)
echo ========================================================
pause
