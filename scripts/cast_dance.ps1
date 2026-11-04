# 헤드리스 화면 녹화 → aiconfirm/dance.mp4 (무음)
param([int]$Port = 9333, [int]$DanceWait = 15, [int]$CastSecs = 8)
$ErrorActionPreference = "Stop"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$prof = "$env:TEMP\edge-cast"
$outdir = "D:\Meta_hackerton\aiconfirm\cast"
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $outdir -Recurse -Force -ErrorAction SilentlyContinue
New-Item $outdir -ItemType Directory | Out-Null
taskkill /F /IM msedge.exe 2>$null
Start-Sleep 2
Start-Process $edge -ArgumentList "--headless --disable-gpu --no-first-run --user-data-dir=`"$prof`" --remote-debugging-port=$Port --autoplay-policy=no-user-gesture-required --window-size=1280,800 about:blank"
Start-Sleep 3
$targets = $null
for ($k = 0; $k -lt 10 -and -not $targets; $k++) {
  try { $targets = Invoke-RestMethod "http://localhost:$Port/json/list" } catch { Start-Sleep 2 }
}
if (-not $targets) { Write-Host "NO DEBUG TARGET"; exit 1 }
$page = @($targets | Where-Object { $_.type -eq "page" })[0]
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$ws.ConnectAsync($page.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult() | Out-Null
$script:seq = 0
$frames = New-Object System.Collections.ArrayList
function Send($m, $pr) {
  $script:seq++
  $o = @{ id = $script:seq; method = $m }
  if ($pr) { $o.params = $pr }
  $j = ($o | ConvertTo-Json -Depth 8 -Compress)
  $b = [System.Text.Encoding]::UTF8.GetBytes($j)
  $ws.SendAsync([System.ArraySegment[byte]]::new($b), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null
}
function Take-Objects([string]$s) {
  # 붙어서 온 JSON들을 중괄호 매칭으로 분리
  $objs = @()
  $depth = 0; $instr = $false; $esc = $false; $start = -1
  for ($i = 0; $i -lt $s.Length; $i++) {
    $c = $s[$i]
    if ($instr) {
      if ($esc) { $esc = $false }
      elseif ($c -eq "\") { $esc = $true }
      elseif ($c -eq '"') { $instr = $false }
    } else {
      if ($c -eq '"') { $instr = $true }
      elseif ($c -eq "{") { if ($depth -eq 0) { $start = $i }; $depth++ }
      elseif ($c -eq "}") {
        $depth--
        if ($depth -eq 0 -and $start -ge 0) { $objs += $s.Substring($start, $i - $start + 1); $start = -1 }
      }
    }
  }
  return $objs
}
function Drain($ms) {
  $buf = New-Object byte[] 1048576
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $ms) {
    $t = $ws.ReceiveAsync([System.ArraySegment[byte]]::new($buf), $cts.Token)
    if (-not $t.Wait(400)) { continue }
    $r = $t.Result
    if ($r.MessageType -eq "Close") { break }
    $text = [System.Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
    foreach ($obj in Take-Objects $text) {
      $j = $obj | ConvertFrom-Json
      if ($j.method -eq "Page.screencastFrame") {
        [void]$frames.Add($j.params.data)
        Send "Page.screencastFrameAck" @{ sessionId = $j.params.sessionId }
      }
    }
  }
}
Send "Page.enable" $null
Send "Page.navigate" @{ url = "http://localhost:3000/pov" }
Drain 6000
Write-Host "LOADED, waiting $DanceWait s idle for dance..."
Drain ($DanceWait * 1000)
Write-Host "CASTING $CastSecs s..."
Send "Page.startScreencast" @{ format = "jpeg"; quality = 55; maxWidth = 640; maxHeight = 400 }
Drain ($CastSecs * 1000)
Send "Page.stopScreencast" $null
Write-Host "FRAMES: $($frames.Count)"
$i = 0
foreach ($f in $frames) {
  $i++
  [System.IO.File]::WriteAllBytes("$outdir\f$($i.ToString('000')).jpg", [System.Convert]::FromBase64String($f))
}
$ws.CloseAsync("NormalClosure", "done", $cts.Token).GetAwaiter().GetResult() | Out-Null
taskkill /F /IM msedge.exe 2>$null
Write-Host "SAVED $i"
