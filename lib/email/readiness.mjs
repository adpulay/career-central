import {spawnSync} from 'node:child_process';

// Capability checks only: never construct persistence, read configuration/cache,
// contact Microsoft, or claim that an installed backend has been validated.
export async function inspectOutlookReadiness({
  platform = process.platform,
  env = process.env,
  extensionLoader = () => import('@azure/msal-node-extensions'),
  run = (command, args) => spawnSync(command, args, {encoding: 'utf8', timeout: 3000, maxBuffer: 65536}),
} = {}) {
  let nativeExtension = 'unavailable';
  try {
    const extension = await extensionLoader();
    if (extension?.PersistenceCreator && extension?.PersistenceCachePlugin && extension?.DataProtectionScope) nativeExtension = 'loadable';
  } catch { /* Provider errors can contain local paths; do not expose them. */ }
  let secretService = 'not-applicable';
  if (platform === 'linux') {
    try {
      // Query owned bus names; do not activate/unlock a service or read entries.
      const result = run('busctl', ['--user', '--no-pager', '--no-legend', '--acquired', 'list']);
      secretService = result.status === 0
        ? (/^org\.freedesktop\.secrets\s/m.test(result.stdout || '') ? 'present' : 'absent')
        : 'unknown';
    } catch { secretService = 'unknown'; }
  }
  const blockers = [];
  if (!['linux', 'win32'].includes(platform)) blockers.push('UNSUPPORTED_PLATFORM');
  if (nativeExtension !== 'loadable') blockers.push('NATIVE_EXTENSION_UNAVAILABLE');
  if (platform === 'linux' && secretService !== 'present') blockers.push('SECRET_SERVICE_NOT_CONFIRMED');
  blockers.push('OS_VAULT_ROUND_TRIP_NOT_VALIDATED');
  return {
    schemaVersion: 1,
    platform,
    wsl: platform === 'linux' && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP),
    nativeExtension,
    secretService,
    persistentBackendValidated: false,
    liveConnectionAuthorized: false,
    blockers,
  };
}
