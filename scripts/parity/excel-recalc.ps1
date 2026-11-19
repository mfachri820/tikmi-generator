<#
  Recalculates each random case (scripts/parity/generate-cases.ts) in Microsoft
  Excel and records every formula cell's value, so the engine can be compared
  with Excel itself (packages/scoring/src/parity.test.ts).

  Opens a scratch copy of the KK read-only and never saves it: the template is
  untouched. Per case: clears every declared input range, writes the case's
  cells, runs a full recalculation, reads the formula cells.

  Output: templates/tikmi/<year>/_parity/results-b<bundling>.json (gitignored:
  results include Sumber BI amounts).

  Usage (from the repo root):
    pwsh -File scripts/parity/excel-recalc.ps1 [-TemplatesDir templates/tikmi/2025] [-Bundlings 2,3]
#>
param(
  [string]$TemplatesDir = "templates/tikmi/2025",
  [int[]]$Bundlings = @(2, 3)
)
$ErrorActionPreference = "Stop"
$TemplatesDir = (Resolve-Path $TemplatesDir).Path

# Excel error values arrive through COM as Int32 codes.
$ErrorCodes = @{
  -2146826288 = "#NULL!"; -2146826281 = "#DIV/0!"; -2146826273 = "#VALUE!"; -2146826265 = "#REF!"
  -2146826259 = "#NAME?"; -2146826252 = "#NUM!"; -2146826246 = "#N/A"; -2146826238 = "#GETTING_DATA"
  -2146826236 = "#SPILL!"; -2146826220 = "#CALC!"
}

function Convert-Value($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [int]) { return @{ error = $(if ($ErrorCodes.ContainsKey($v)) { $ErrorCodes[$v] } else { "#ERR$v" }) } }
  return $v
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $false
$excel.EnableEvents = $false
try {
  foreach ($b in $Bundlings) {
    $casesFile = Join-Path $TemplatesDir "_parity/cases-b$b.json"
    $spec = Get-Content $casesFile -Raw | ConvertFrom-Json
    $def = Get-Content "packages/scoring/definitions/2025-mr-b$b.json" -Raw | ConvertFrom-Json
    $formulaRefs = @($def.spec.formulas.PSObject.Properties.Name)

    $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("tikmi-parity-b$b-" + [guid]::NewGuid().ToString("N") + ".xlsx")
    Copy-Item (Join-Path $TemplatesDir $spec.templateFile) $scratch
    $wb = $excel.Workbooks.Open($scratch, 0, $true)
    $excel.Calculation = -4135  # manual while writing

    # Formula refs grouped by sheet, with row/col for reading from one Value2 block per sheet.
    $bySheet = @{}
    foreach ($ref in $formulaRefs) {
      $i = $ref.LastIndexOf("!")
      $sheet = $ref.Substring(0, $i); $addr = $ref.Substring($i + 1)
      if (-not $bySheet.ContainsKey($sheet)) { $bySheet[$sheet] = New-Object System.Collections.ArrayList }
      [void]$bySheet[$sheet].Add(@($ref, $addr))
    }

    $results = New-Object System.Collections.ArrayList
    $n = 0
    foreach ($case in $spec.cases) {
      $n++
      foreach ($decl in $spec.inputRanges) {
        $ws = $wb.Worksheets.Item($decl.sheet)
        foreach ($r in $decl.ranges) {
          try { $ws.Range($r).ClearContents() | Out-Null }
          catch { foreach ($c in $ws.Range($r).Cells) { try { $c.MergeArea.ClearContents() | Out-Null } catch {} } }
        }
      }
      foreach ($p in $case.cells.PSObject.Properties) {
        $i = $p.Name.LastIndexOf("!")
        $cell = $wb.Worksheets.Item($p.Name.Substring(0, $i)).Range($p.Name.Substring($i + 1))
        if ($p.Value -is [string]) { $cell.NumberFormat = "@"; $cell.Value2 = [string]$p.Value }
        else { $cell.NumberFormat = "General"; $cell.Value2 = [double]$p.Value }
      }
      $excel.CalculateFull()

      $values = [ordered]@{}
      foreach ($sheet in $bySheet.Keys) {
        $ws = $wb.Worksheets.Item($sheet)
        foreach ($pair in $bySheet[$sheet]) { $values[$pair[0]] = Convert-Value ($ws.Range($pair[1]).Value2) }
      }
      [void]$results.Add([ordered]@{ seed = $case.seed; values = $values })
      Write-Host "B$b case $n/$($spec.cases.Count) done"
    }
    $wb.Close($false)
    Remove-Item $scratch -ErrorAction SilentlyContinue
    $out = Join-Path $TemplatesDir "_parity/results-b$b.json"
    [ordered]@{ bundling = $b; excelVersion = $excel.Version; results = $results } | ConvertTo-Json -Depth 6 -Compress | Set-Content -Encoding utf8 $out
    Write-Host "Wrote $out"
  }
}
finally {
  try { if ($excel.Workbooks.Count -gt 0) { $excel.Calculation = -4105 } } catch {}
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
