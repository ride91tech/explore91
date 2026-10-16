<#
  Creates the Android release (upload) keystore for Explore91 and wires it into
  Gradle.

  Run it once, on the machine that will build releases:

      powershell -ExecutionPolicy Bypass -File frontend\scripts\make-release-keystore.ps1

  What it does:
    * generates a 32-character random password (never shown on screen)
    * creates C:\Users\<you>\keys\explore91-release.jks  (PKCS12, RSA 4096)
    * writes the EXPLORE91_UPLOAD_* properties into ~\.gradle\gradle.properties,
      which is outside the repo, so the secret is never committed
    * writes a recovery note next to the keystore with the password in it
    * prints the SHA-1 and SHA-256 fingerprints, which are public

  It refuses to run if a keystore is already there. Overwriting one you have
  already published with is unrecoverable.
#>

$ErrorActionPreference = "Stop"

$keysDir     = Join-Path $env:USERPROFILE "keys"
$storePath   = Join-Path $keysDir "explore91-release.jks"
$storeForJava = $storePath -replace '\\', '/'   # .properties treats \ as an escape
$alias       = "explore91"
$gradleProps = Join-Path $env:USERPROFILE ".gradle\gradle.properties"
$note        = Join-Path $keysDir "explore91-keystore-RECOVERY.txt"

if (Test-Path $storePath) {
    Write-Host "A keystore already exists at $storePath - refusing to overwrite it." -ForegroundColor Yellow
    Write-Host "Delete it by hand first if you are certain it was never published with."
    exit 1
}

# Locate keytool: Android Studio's bundled JDK, then JAVA_HOME, then PATH.
$candidates = @(
    "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe",
    "C:\Program Files\Android\Android Studio\jre\bin\keytool.exe"
)
if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME "bin\keytool.exe") }
$keytool = $null
foreach ($c in $candidates) { if (Test-Path $c) { $keytool = $c; break } }
if (-not $keytool) {
    $onPath = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($onPath) { $keytool = $onPath.Source }
}
if (-not $keytool) { throw "keytool.exe not found. Install Android Studio or a JDK." }

# 32 chars, alphanumeric only - safe inside a Java .properties file.
$chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
$bytes = New-Object byte[] 64
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$sb = New-Object System.Text.StringBuilder
for ($i = 0; $i -lt 32; $i++) {
    [void]$sb.Append($chars[$bytes[$i] % $chars.Length])
}
$pw = $sb.ToString()

New-Item -ItemType Directory -Force -Path $keysDir | Out-Null

# PKCS12 is keytool's default store type on modern JDKs, which is also what the
# Android Gradle plugin assumes when no storeType is given. In PKCS12 the store
# and key passwords have to match.
& $keytool -genkeypair `
    -keystore $storePath `
    -alias $alias `
    -keyalg RSA -keysize 4096 `
    -validity 10000 `
    -dname "CN=Explore91, OU=Mobile, O=Explore91, L=Mumbai, ST=Maharashtra, C=IN" `
    -storepass $pw -keypass $pw | Out-Null

if (-not (Test-Path $storePath)) { throw "keytool did not produce a keystore." }

# Merge into ~\.gradle\gradle.properties, dropping any stale EXPLORE91_ lines.
New-Item -ItemType Directory -Force -Path (Split-Path $gradleProps) | Out-Null
$kept = @()
if (Test-Path $gradleProps) {
    $kept = Get-Content $gradleProps | Where-Object { $_ -notmatch '^EXPLORE91_UPLOAD_' }
}
$lines = $kept + @(
    "EXPLORE91_UPLOAD_STORE_FILE=$storeForJava",
    "EXPLORE91_UPLOAD_STORE_PASSWORD=$pw",
    "EXPLORE91_UPLOAD_KEY_ALIAS=$alias",
    "EXPLORE91_UPLOAD_KEY_PASSWORD=$pw"
)
Set-Content -Path $gradleProps -Value $lines -Encoding ascii

@(
    "Explore91 Android release (upload) key",
    "Created:  $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    "Keystore: $storePath",
    "Alias:    $alias",
    "Type:     PKCS12, RSA 4096, valid 10000 days",
    "Password (store and key are the same): $pw",
    "",
    "MOVE THIS PASSWORD INTO A PASSWORD MANAGER, THEN DELETE THIS FILE.",
    "Back up explore91-release.jks somewhere off this machine.",
    "If the keystore or its password is lost you can never ship another",
    "update to this app under the same Play Store listing."
) | Set-Content -Path $note -Encoding ascii

Write-Host ""
Write-Host "Keystore created: $storePath"
Write-Host "Gradle signing configured in: $gradleProps"
Write-Host "Password written to: $note  (move it to a password manager, then delete)"
Write-Host ""
Write-Host "Fingerprints (public - paste the SHA-1 where Google asks for it):" -ForegroundColor Cyan

# Only the fingerprint lines go to the screen; nothing here reveals the password.
& $keytool -list -v -keystore $storePath -alias $alias -storepass $pw 2>$null |
    Select-String -Pattern 'Alias name|Valid from|SHA1:|SHA256:' |
    ForEach-Object { "  " + $_.Line.Trim() }
