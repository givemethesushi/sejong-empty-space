param(
    [int]$Port = 8080
)

$root = Split-Path -Parent $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "Serving $root at $prefix (Ctrl+C to stop)"

$mimeTypes = @{
    '.html'        = 'text/html; charset=utf-8'
    '.css'         = 'text/css; charset=utf-8'
    '.js'          = 'application/javascript; charset=utf-8'
    '.json'        = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.svg'         = 'image/svg+xml'
    '.png'         = 'image/png'
    '.ico'         = 'image/x-icon'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $reqPath = $ctx.Request.Url.AbsolutePath
        if ($reqPath -eq '/') { $reqPath = '/index.html' }
        $relPath = $reqPath.TrimStart('/').Replace('/', '\')
        $filePath = Join-Path $root $relPath

        if ((Test-Path $filePath -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $ctx.Response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
        }
        $ctx.Response.Close()
    }
} finally {
    $listener.Stop()
}
