@echo off
rem Deterministic fake Muse CLI for tests. Set FAKE_MUSE_NODE to pick a specific node binary.
if defined FAKE_MUSE_NODE (
  "%FAKE_MUSE_NODE%" "%~dp0fake-muse.mjs" %*
) else (
  node "%~dp0fake-muse.mjs" %*
)
exit /b %ERRORLEVEL%
