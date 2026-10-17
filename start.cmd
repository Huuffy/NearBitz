@echo off
rem Double-click to start GeoSales.ai (runs scripts\start.ps1 without changing the system execution policy).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
