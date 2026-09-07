# Builds the deployment images and saves them as ONE portable tarball.
# PowerShell equivalent of build-images.sh, for building on Windows with
# Docker Desktop.
#
#   .\scripts\build-images.ps1
#   .\scripts\build-images.ps1 -Tag 1.1.0
#
# The output goes to `images\` and is git-ignored: it is 300-500 MB, and GitHub
# refuses any file over 100 MB. Carry it to the server by USB, scp or a file
# share, then run `scripts/load-images.sh` there.

param([string]$Tag = '1.0.0')

$ErrorActionPreference = 'Stop'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageDir = Split-Path -Parent $scriptDir
$repoRoot   = Resolve-Path (Join-Path $packageDir '..\..')

$apiImage = "asset-management/api:$Tag"
$webImage = "asset-management/web:$Tag"

# The stack runs four images, not two. A server with no registry access needs
# every one of them; the base images are the ones people forget until `up -d`
# fails on a machine with no internet.
$baseImages = @('postgres:16-alpine', 'redis:7-alpine', 'nginx:1.27-alpine')

if (-not (Test-Path (Join-Path $repoRoot 'apps\api\Dockerfile'))) {
  throw "Cannot find the source tree at $repoRoot. Run this from inside the repository."
}

Write-Host "==> building $apiImage"
docker build -f (Join-Path $repoRoot 'apps\api\Dockerfile') -t $apiImage $repoRoot
if ($LASTEXITCODE -ne 0) { throw 'API image build failed' }

# VITE_API_BASE_URL is inlined at BUILD time by Vite. The relative `/api/v1` is
# what makes one image work at any hostname or IP.
Write-Host "==> building $webImage"
docker build -f (Join-Path $repoRoot 'apps\web\Dockerfile') --build-arg VITE_API_BASE_URL=/api/v1 -t $webImage $repoRoot
if ($LASTEXITCODE -ne 0) { throw 'Web image build failed' }

Write-Host '==> pulling base images'
foreach ($image in $baseImages) {
  docker pull $image
  if ($LASTEXITCODE -ne 0) { throw "Failed to pull $image" }
}

$imagesDir = Join-Path $packageDir 'images'
if (-not (Test-Path $imagesDir)) { New-Item -ItemType Directory $imagesDir | Out-Null }
$bundle = Join-Path $imagesDir "asset-management-$Tag.tar"

# `docker save -o` rather than a pipe: PowerShell's pipeline is text, and
# streaming a tar through it corrupts the archive.
Write-Host "==> saving all four images to $bundle"
docker save -o $bundle $apiImage $webImage @baseImages
if ($LASTEXITCODE -ne 0) { throw 'docker save failed' }

Write-Host '==> compressing'
if (Test-Path "$bundle.gz") { Remove-Item "$bundle.gz" }
# .NET GZip, so nothing outside PowerShell has to be installed.
$in  = [System.IO.File]::OpenRead($bundle)
$out = [System.IO.File]::Create("$bundle.gz")
$gzip = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Optimal)
$in.CopyTo($gzip)
$gzip.Dispose(); $out.Dispose(); $in.Dispose()
Remove-Item $bundle

$sizeMb = [math]::Round((Get-Item "$bundle.gz").Length / 1MB, 1)

Write-Host ''
Write-Host "Done. $bundle.gz ($sizeMb MB)"
Write-Host ''
Write-Host 'Copy to the server, then there:'
Write-Host "  ./scripts/load-images.sh images/asset-management-$Tag.tar.gz"
if ($Tag -ne '1.0.0') {
  Write-Host ''
  Write-Host "Set these in the server's .env:"
  Write-Host "  API_IMAGE=$apiImage"
  Write-Host "  WEB_IMAGE=$webImage"
}
