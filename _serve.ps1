param(
    [int]$Port = 8765
)

$root = $PSScriptRoot
$prefix = "http://127.0.0.1:$Port/"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.map'  = 'application/json'
    '.wasm' = 'application/wasm'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "[错误] 无法监听 $prefix"
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host "Serving $root"
Write-Host "Open $prefix"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response

    try {
        $rel = [Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
        $rel = $rel -replace '/', '\'
        $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))

        if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $res.StatusCode = 403
            $bytes = [Text.Encoding]::UTF8.GetBytes('Forbidden')
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
            $res.StatusCode = 404
            $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            $ctype = $mime[$ext]
            if (-not $ctype) { $ctype = 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($full)
            $res.StatusCode = 200
            $res.ContentType = $ctype
            $res.ContentLength64 = $bytes.Length
            $res.Headers['Cache-Control'] = 'no-cache'
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    }
    catch {
        try {
            $res.StatusCode = 500
            $msg = [Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
            $res.OutputStream.Write($msg, 0, $msg.Length)
        } catch {}
    }
    finally {
        try { $res.OutputStream.Close() } catch {}
    }
}
