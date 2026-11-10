import {execFileSync} from 'node:child_process';

// Check native Windows ACLs; POSIX mode bits cannot establish Windows privacy.
// No DPAPI bridge, vault operation, ACL mutation or user-controlled PowerShell.
const script = `
$ErrorActionPreference = 'Stop'
try {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $env:CAREER_OPS_ACL_CHECK_PATH
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) { exit 2 }
  foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid, 'S-1-5-18')) { exit 2 }
  }
  if (-not ($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $sid })) { exit 2 }
  Write-Output 'PRIVATE_ACL_CONFIRMED'
} catch { exit 2 }
`;
export function assertWindowsPrivatePath(target, {run = execFileSync} = {}) {
  try {
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4096, windowsHide: true,
      env: {...process.env, CAREER_OPS_ACL_CHECK_PATH: target}, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.trim() !== 'PRIVATE_ACL_CONFIRMED') throw Error();
  } catch { throw Object.assign(Error('WINDOWS_PRIVATE_ACL_UNVALIDATED'), {code: 'WINDOWS_PRIVATE_ACL_UNVALIDATED'}); }
}
