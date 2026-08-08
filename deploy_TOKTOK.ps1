$ErrorActionPreference = "Stop"
$ProjectName = "tok-tok"

Write-Host "TOKTOK BYOK deploy" -ForegroundColor Cyan
Write-Host "Project: $ProjectName"
Write-Host "OpenAI API key is entered by each user in the app; no Cloudflare secret is required." -ForegroundColor Yellow

npx wrangler pages deploy . --project-name $ProjectName

Write-Host ""
Write-Host "Deploy complete." -ForegroundColor Green
