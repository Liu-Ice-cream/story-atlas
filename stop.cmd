@echo off
if not defined STORY_ATLAS_PORT set "STORY_ATLAS_PORT=4317"
powershell -NoProfile -Command "$storyBody = @{confirm=$true} | ConvertTo-Json; try { Invoke-RestMethod -Uri ('http://127.0.0.1:' + $env:STORY_ATLAS_PORT + '/api/shutdown') -Method Post -ContentType 'application/json' -Body $storyBody | Out-Null; Write-Host 'Story Atlas stopped.' } catch { Write-Host 'No running Story Atlas service found on this port.' }"
