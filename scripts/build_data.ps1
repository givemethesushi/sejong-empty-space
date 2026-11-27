param(
    [string]$XlsxPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data\timetable_2026_2.xlsx')
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'data') | Out-Null

if (-not (Test-Path $XlsxPath -PathType Leaf)) {
    Write-Error "Timetable Excel file not found: $XlsxPath`nUsage: .\scripts\build_data.ps1 -XlsxPath path\to\timetable.xlsx"
    exit 1
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $XlsxPath).Path)

function Read-ZipEntryText($zipObj, $entryName) {
    $entry = $zipObj.GetEntry($entryName)
    if (-not $entry) { return $null }
    $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd()
    $sr.Close()
    return $text
}

$ssXml = [xml](Read-ZipEntryText $zip 'xl/sharedStrings.xml')
$sharedStrings = New-Object System.Collections.Generic.List[string]
foreach ($si in $ssXml.sst.si) {
    if ($si.t) {
        if ($si.t -is [string]) { $sharedStrings.Add($si.t) }
        else { $sharedStrings.Add($si.t.'#text') }
    } elseif ($si.r) {
        $sb = New-Object System.Text.StringBuilder
        foreach ($r in $si.r) {
            if ($r.t -is [string]) { [void]$sb.Append($r.t) }
            elseif ($r.t.'#text') { [void]$sb.Append($r.t.'#text') }
        }
        $sharedStrings.Add($sb.ToString())
    } else {
        $sharedStrings.Add('')
    }
}

function Col-ToIndex($colLetters) {
    $idx = 0
    foreach ($ch in $colLetters.ToCharArray()) {
        $idx = $idx * 26 + ([int]$ch - [int][char]'A' + 1)
    }
    return $idx - 1
}

$sheetXml = [xml](Read-ZipEntryText $zip 'xl/worksheets/sheet1.xml')
$zip.Dispose()

$rows = New-Object System.Collections.Generic.List[object]
$isHeader = $true
foreach ($row in $sheetXml.worksheet.sheetData.row) {
    if ($isHeader) { $isHeader = $false; continue }
    $cells = @{}
    foreach ($c in $row.c) {
        $colLetters = $c.r -replace '\d+', ''
        $colIdx = Col-ToIndex $colLetters
        $val = ''
        if ($c.t -eq 's') { $val = $sharedStrings[[int]$c.v] }
        elseif ($c.t -eq 'inlineStr') { $val = $c.is.t }
        elseif ($null -ne $c.v) { $val = [string]$c.v }
        $cells[$colIdx] = $val
    }
    $rows.Add($cells)
}

function Get-Building($room) {
    if ($room -match '^광[1-4]\d\d(?!\d)') { return '광개토관' }
    if ($room -match '^센') { return '대양AI센터' }
    if ($room -match '^충') { return '충무관' }
    if ($room -match '^군') { return '군자관' }
    if ($room -match '^집') { return '집현관' }
    return $null
}

function Parse-TimeToMin($hhmm) {
    $parts = $hhmm -split ':'
    return ([int]$parts[0]) * 60 + ([int]$parts[1])
}

# Step 1: Filter valid courses & collect room stats
$validCourses = New-Object System.Collections.Generic.List[object]
$roomStats = @{}
$cyber = 0; $noTime = 0; $noRoom = 0

foreach ($r in $rows) {
    $cyberVal = if ($r.ContainsKey(20)) { $r[20].Trim() } else { '' }
    $timeVal  = if ($r.ContainsKey(14)) { $r[14].Trim() } else { '' }
    $roomVal  = if ($r.ContainsKey(15)) { $r[15].Trim() } else { '' }
    $typeVal  = if ($r.ContainsKey(12)) { $r[12].Trim() } else { '' }
    $titleVal = if ($r.ContainsKey(6))  { $r[6].Trim() } else { '' }
    $profVal  = if ($r.ContainsKey(16)) { $r[16].Trim() } else { '' }

    if ($cyberVal -ne '') { $cyber++; continue }
    if ($timeVal -eq '')  { $noTime++; continue }
    if ($roomVal -eq '')  { $noRoom++; continue }

    $roomsList = @($roomVal -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    $validCourses.Add(@{
        title = $titleVal
        prof  = $profVal
        type  = $typeVal
        time  = $timeVal
        rooms = $roomsList
    })

    foreach ($rm in $roomsList) {
        if (-not $roomStats.ContainsKey($rm)) {
            $roomStats[$rm] = @{ total=0; theory=0 }
        }
        $roomStats[$rm].total++
        if ($typeVal -eq '이론') { $roomStats[$rm].theory++ }
    }
}

# Select candidate rooms: 5 main buildings & theory ratio >= 50%
$candidateRooms = @{}
$bldgCounts = @{}
foreach ($rm in ($roomStats.Keys | Sort-Object)) {
    $bldg = Get-Building $rm
    if (-not $bldg) { continue }
    $s = $roomStats[$rm]
    if (($s.theory / $s.total) -ge 0.5) {
        $candidateRooms[$rm] = $bldg
        if (-not $bldgCounts.ContainsKey($bldg)) { $bldgCounts[$bldg] = 0 }
        $bldgCounts[$bldg]++
    }
}

Write-Output "=== Filtering Summary ==="
Write-Output "Total=$($rows.Count), Cyber=$cyber, NoTime=$noTime, NoRoom=$noRoom, Valid=$($validCourses.Count)"
Write-Output "Candidate rooms total: $($candidateRooms.Count)"
foreach ($b in @('광개토관','대양AI센터','충무관','군자관','집현관')) {
    Write-Output "  $b : $($bldgCounts[$b])"
}

# Step 2: Parse time segments and map to candidate rooms
# Time string examples:
# "화 18:00~19:00"
# "화 목 15:00~16:30"
# "월 09:00~11:00, 화 목 09:00~10:30"
# "금 12:00~14:00, 금 15:00~17:00"
$daysOrder = @('월','화','수','목','금')
$roomSchedule = @{}
foreach ($rm in $candidateRooms.Keys) {
    $roomSchedule[$rm] = @{
        '월' = New-Object System.Collections.Generic.List[object]
        '화' = New-Object System.Collections.Generic.List[object]
        '수' = New-Object System.Collections.Generic.List[object]
        '목' = New-Object System.Collections.Generic.List[object]
        '금' = New-Object System.Collections.Generic.List[object]
    }
}

$ambiguousCount = 0

foreach ($course in $validCourses) {
    $timeSegments = @($course.time -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    $parsedSegs = New-Object System.Collections.Generic.List[object]

    foreach ($seg in $timeSegments) {
        if ($seg -match '([월화수목금토일\s]+)\s*(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})') {
            $dayPart = $Matches[1].Trim()
            $startMin = Parse-TimeToMin $Matches[2]
            $endMin   = Parse-TimeToMin $Matches[3]
            $segDays = @([regex]::Matches($dayPart, '[월화수목금]') | ForEach-Object { $_.Value })
            if ($segDays.Count -gt 0) {
                $parsedSegs.Add(@{ days=$segDays; start=$startMin; end=$endMin })
            }
        }
    }

    if ($parsedSegs.Count -eq 0) { continue }

    $rooms = $course.rooms
    # PPT rule: if room count == segment count and > 1, 1-to-1? Or if rooms.Count == 1, apply all segs to that room.
    # If mismatch (ambiguous), mark ALL rooms occupied for ALL segments!
    if ($rooms.Count -eq 1) {
        $rm = $rooms[0]
        if ($candidateRooms.ContainsKey($rm)) {
            foreach ($ps in $parsedSegs) {
                foreach ($d in $ps.days) {
                    $roomSchedule[$rm][$d].Add(@{ start=$ps.start; end=$ps.end; title=$course.title; prof=$course.prof })
                }
            }
        }
    } elseif ($rooms.Count -eq $parsedSegs.Count) {
        # Check if ambiguous? Even in PPT: "강의실 수와 시간 구간 수가 안 맞으면 모두 사용 중으로 처리"
        for ($i = 0; $i -lt $rooms.Count; $i++) {
            $rm = $rooms[$i]
            $ps = $parsedSegs[$i]
            if ($candidateRooms.ContainsKey($rm)) {
                foreach ($d in $ps.days) {
                    $roomSchedule[$rm][$d].Add(@{ start=$ps.start; end=$ps.end; title=$course.title; prof=$course.prof })
                }
            }
        }
    } else {
        $ambiguousCount++
        foreach ($rm in $rooms) {
            if ($candidateRooms.ContainsKey($rm)) {
                foreach ($ps in $parsedSegs) {
                    foreach ($d in $ps.days) {
                        $roomSchedule[$rm][$d].Add(@{ start=$ps.start; end=$ps.end; title=$course.title; prof=$course.prof })
                    }
                }
            }
        }
    }
}

Write-Output "Ambiguous courses (room count != seg count): $ambiguousCount"

# Verification 1: 목 18:00, 광개토관, 2시간 이상
function Get-FreeUntil($slots, $queryMin) {
    $dayEnd = 22 * 60
    $nextStart = $dayEnd
    foreach ($s in $slots) {
        if ($s.start -le $queryMin -and $queryMin -lt $s.end) {
            return $null # occupied
        }
        if ($s.start -gt $queryMin -and $s.start -lt $nextStart) {
            $nextStart = $s.start
        }
    }
    return $nextStart
}

$thu18Gwang = New-Object System.Collections.Generic.List[string]
foreach ($rm in ($candidateRooms.Keys | Sort-Object)) {
    if ($candidateRooms[$rm] -ne '광개토관') { continue }
    $until = Get-FreeUntil $roomSchedule[$rm]['목'] (18 * 60)
    if ($null -ne $until -and ($until - 18 * 60) -ge 120) {
        $thu18Gwang.Add($rm)
    }
}
Write-Output "`n[Check 1] 목 18:00 광개토관 2시간 이상 = $($thu18Gwang.Count)실 (PPT: 17실)"
Write-Output ("  Rooms: " + ($thu18Gwang -join ', '))

# Verification 2: 화 10:30 전체 5개 건물 빈 강의실 (30분 이상)
$tue1030All = New-Object System.Collections.Generic.List[string]
foreach ($rm in ($candidateRooms.Keys | Sort-Object)) {
    $until = Get-FreeUntil $roomSchedule[$rm]['화'] (10 * 60 + 30)
    if ($null -ne $until -and ($until - (10 * 60 + 30)) -ge 30) {
        $tue1030All.Add($rm)
    }
}
Write-Output "[Check 2] 화 10:30 전체 5개 건물 빈 강의실 = $($tue1030All.Count)실 (PPT: 13실)"
Write-Output ("  Rooms: " + ($tue1030All -join ', '))

# Build clean JSON for the web app
$roomsOutput = @()
foreach ($rm in ($candidateRooms.Keys | Sort-Object)) {
    $bldg = $candidateRooms[$rm]
    $schedOut = [ordered]@{}
    foreach ($d in $daysOrder) {
        $sorted = @($roomSchedule[$rm][$d] | Sort-Object { $_.start }, { $_.end })
        $dedup = @()
        foreach ($item in $sorted) {
            $exists = $false
            foreach ($ex in $dedup) {
                if ($ex.s -eq $item.start -and $ex.e -eq $item.end -and $ex.t -eq $item.title) {
                    $exists = $true; break
                }
            }
            if (-not $exists) {
                $dedup += [PSCustomObject]@{
                    s = [int]$item.start
                    e = [int]$item.end
                    t = [string]$item.title
                    p = [string]$item.prof
                }
            }
        }
        $schedOut.Add($d, $dedup)
    }
    $seats = if ($bldg -eq '광개토관') { 50 } else { 40 }
    $roomsOutput += [PSCustomObject]@{
        id       = $rm
        building = $bldg
        seats    = $seats
        schedule = $schedOut
    }
}

$payload = [PSCustomObject]@{
    meta = [PSCustomObject]@{
        semester = '2026-2학기'
        totalCourses = $rows.Count
        validCourses = $validCourses.Count
        roomCount = $roomsOutput.Count
        buildings = @('광개토관','대양AI센터','충무관','군자관','집현관')
    }
    rooms = $roomsOutput
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress
$jsonPath = Join-Path $projectRoot 'data\schedule.json'
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Output "`nSaved $jsonPath ($($json.Length) bytes)"

$jsDir = Join-Path $projectRoot 'js'
New-Item -ItemType Directory -Force -Path $jsDir | Out-Null
$jsPath = Join-Path $jsDir 'schedule-data.js'
$jsContent = "// Auto-generated from timetable Excel`nwindow.SCHEDULE_DATA = $json;`n"
[System.IO.File]::WriteAllText($jsPath, $jsContent, (New-Object System.Text.UTF8Encoding $false))
Write-Output "Saved $jsPath ($($jsContent.Length) bytes)"
