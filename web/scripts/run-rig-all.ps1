# R2+R3 24종 일괄 실행. 종별 run.log에 블렌더 출력 저장.
# Meta_hackerton 루트에서: powershell -File scripts/run-rig-all.ps1
# 일부만: powershell -File scripts/run-rig-all.ps1 -Only fire-05,grass-05
param($Only = @())
$BL = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$IDS = @(
  'fire-01','rock-03','water-01','wind-04',
  'fire-02','fire-03','fire-04','fire-05','grass-01','grass-02','grass-03','grass-04','grass-05',
  'water-02','water-03','water-04','water-05','wind-01','wind-02','wind-03','wind-05',
  'rock-01','rock-02','rock-04'
)
if ($Only -is [string]) { $Only = $Only.Split(',') }
if ($Only.Count -gt 0) {
  $F = @()
  foreach ($i in $IDS) { if ($Only -contains $i) { $F += $i } }
  $IDS = $F
}
function RunBlender($Log, $ArgList) {
  $p = Start-Process $BL -ArgumentList $ArgList -NoNewWindow -PassThru -RedirectStandardOutput $Log -RedirectStandardError 'scratch/rig-types/bl-err.tmp'
  $done = $p.WaitForExit(600000)
  if (-not $done) {
    Stop-Process -Id $p.Id -Force
    return @('TIMEOUT', '')
  }
  $err = Get-Content 'scratch/rig-types/bl-err.tmp' -Raw
  if ($null -eq $err) { $err = '' }
  return @('EXIT', $err)
}
$null = New-Item -ItemType Directory -Force -Path 'scratch/rig-types'
if ($Only.Count -eq 0) {
  Set-Content 'scratch/rig-types/run-log.txt' 'run start' -Encoding utf8
} else {
  Add-Content 'scratch/rig-types/run-log.txt' '--- rerun ---' -Encoding utf8
}
foreach ($id in $IDS) {
  $dir = "scratch/rig-types/$id"
  $null = New-Item -ItemType Directory -Force -Path $dir
  $log = "$dir/run.log"
  Set-Content $log "== $id ==" -Encoding utf8
  $ok = $false
  $glb = "$dir/$id-rigged.glb"
  for ($try = 1; $try -le 3; $try++) {
    Add-Content $log "== try $try rig-type =="
    if (Test-Path $glb) { Remove-Item $glb -Force }
    $rx1 = RunBlender 'scratch/rig-types/bl-out.tmp' @(
      '--background','--factory-startup','--python-exit-code','1',
      '--python','scripts/rig-type.py','--',
      '--id',$id,'--src','public/models',
      '--lm','scratch/landmarks/landmarks-3d.json',
      '--out',$dir)
    $r1 = $rx1[0]
    $o1 = Get-Content 'scratch/rig-types/bl-out.tmp' -Raw
    if ($null -eq $o1) { $o1 = '' }
    Add-Content $log $o1
    Add-Content $log '[stderr]'
    Add-Content $log $rx1[1]
    Add-Content $log "rig-type result: $r1"
    $done1 = $o1.Contains("[rig] $id DONE")
    if (($r1 -eq 'EXIT') -and $done1 -and (Test-Path $glb)) {
      Add-Content $log '== rig-inspect =='
      $insp = @("$dir/$id-inspect-weights-front.png", "$dir/$id-inspect-weights-side.png", "$dir/$id-inspect-bones-front.png", "$dir/$id-inspect-bones-side.png")
      foreach ($f in $insp) { if (Test-Path $f) { Remove-Item $f -Force } }
      $rx2 = RunBlender 'scratch/rig-types/bl-out.tmp' @(
        '--background','--factory-startup','--python-exit-code','1',
        '--python','scripts/rig-inspect.py','--',
        '--glb',$glb,'--out',$dir,'--name',"$id-inspect")
      $r2 = $rx2[0]
      $o2 = Get-Content 'scratch/rig-types/bl-out.tmp' -Raw
      if ($null -eq $o2) { $o2 = '' }
      Add-Content $log $o2
      Add-Content $log '[stderr]'
      Add-Content $log $rx2[1]
      Add-Content $log "rig-inspect result: $r2"
      $allpng = $true
      foreach ($f in $insp) { if (-not (Test-Path $f)) { $allpng = $false } }
      if (($r2 -eq 'EXIT') -and $o2.Contains('[rig-inspect] DONE') -and $allpng) { $ok = $true }
      break
    }
  }
  if ($ok) {
    "$id OK"
    Add-Content 'scratch/rig-types/run-log.txt' "$id OK" -Encoding utf8
  } else {
    "$id FAIL"
    Add-Content 'scratch/rig-types/run-log.txt' "$id FAIL" -Encoding utf8
  }
}
Add-Content 'scratch/rig-types/run-log.txt' 'run end' -Encoding utf8
