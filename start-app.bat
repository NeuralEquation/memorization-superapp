@echo off
cd /d "%~dp0"
echo 暗記Foundry: http://127.0.0.1:8877/
py -m http.server 8877 --bind 127.0.0.1

