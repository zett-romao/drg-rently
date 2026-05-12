@echo off
REM ============================================================
REM  DRG-Rently - Setup Git para subir no GitHub
REM ============================================================
REM
REM  Como usar:
REM  1. Abra este arquivo num editor de texto
REM  2. Substitua SEU-USUARIO pelo seu user do GitHub
REM  3. Salve
REM  4. De duplo-clique pra rodar
REM
REM ============================================================

echo.
echo === DRG-Rently — Setup Git ===
echo.

REM Verifica se Git esta instalado
where git >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Git nao encontrado. Instale em https://git-scm.com/
    pause
    exit /b 1
)

echo Git encontrado. Continuando...
echo.

REM Pega o usuario do GitHub
set /p github_user="Digite seu usuario do GitHub: "

REM Inicializa repo
git init
git add .
git commit -m "Initial commit — DRG-Rently"
git branch -M main
git remote add origin https://github.com/%github_user%/drg-rently.git
git push -u origin main

echo.
echo ============================================================
echo  PRONTO! Codigo subiu no GitHub.
echo.
echo  Proximos passos:
echo  1. Ative o GitHub Pages em Settings ^> Pages
echo  2. Configure os Workers no Cloudflare
echo  3. Faca o bootstrap do super_admin
echo.
echo  Leia o PASSO-A-PASSO.md para detalhes.
echo ============================================================
echo.
pause
