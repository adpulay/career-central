import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {acquireDirLock} from '../dir-lock.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {LogLevel} from '@azure/msal-node';
import {privateDirectory,assertPrivateStorageFile} from './private-storage.mjs';

const fixedError = code => Object.assign(Error(code), {code});
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');

// Session-only storage deliberately never writes a serialized value to disk.
export function createSessionPersistence() {
  let value = null;
  return Object.freeze({
    async save(next) { if (typeof next !== 'string') throw fixedError('INVALID_PROTECTED_VALUE'); value = next; },
    async load() { return value; },
    async delete() { const existed = value !== null; value = null; return existed; },
    async reloadNecessary() { return false; },
    getFilePath() { return ''; },
    getLogger() { return { verbose() {}, info() {}, warning() {}, error() {} }; },
    async verifyPersistence() { return true; },
    async createForPersistenceValidation() { return createSessionPersistence(); },
  });
}

export function detectedCredentialCapabilities({platform = process.platform, env = process.env, commands = {}} = {}) {
  const wsl = platform === 'linux' && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const windowsInterop = wsl && Boolean(commands.powershell || commands.powershellExe);
  return Object.freeze({
    platform, wsl, windowsInterop,
    dbusSessionAddressConfigured: platform === 'linux' && Boolean(env.DBUS_SESSION_BUS_ADDRESS),
    microsoftExtensionInstalled: Boolean(commands.extensionInstalled),
    persistentBackendValidated: false,
  });
}

// Microsoft Authentication Extensions provides DPAPI (Windows) and LibSecret
// (Linux). Its Linux plaintext fallback is explicitly disabled. Errors are
// intentionally collapsed so neither the library nor secret values are shown.
export async function createMicrosoftProtectedPersistence({repo, storageDir = path.join(os.homedir(), '.local/state/career-ops/outlook'), serviceName = 'CareerCentral', accountName = 'default', extensionLoader = () => import('@azure/msal-node-extensions')} = {}) {
  if (!opaque(accountName)) throw fixedError('INVALID_PROTECTED_ACCOUNT_KEY');
  const directory = privateDirectory(storageDir, repo);
  let validationLock;
  try {
    validationLock = await acquireDirLock(path.join(directory, 'backend-validation.lock'), {timeoutMs: 5000, retryMs: 25, maxWaitMs: 5000});
    // The vendor verifier uses test.cache in this directory. Never overwrite a
    // pre-existing file, and serialize cooperating validators in this directory.
    try {fs.lstatSync(path.join(directory, 'test.cache')); throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    const cachePath = path.join(directory, `protected-${hash(`${serviceName}:${accountName}`).slice(0, 32)}.lock`);
    assertPrivateStorageFile(cachePath);
    const ext = await extensionLoader();
    if (!ext?.PersistenceCreator || !ext?.PersistenceCachePlugin || !ext?.DataProtectionScope) throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
    // The vendor uses the existing file's permissions. Create it owner-only
    // before its first write instead of relying on the process umask.
    try {const fd = fs.openSync(cachePath, 'wx', 0o600); fs.closeSync(fd);}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
    assertPrivateStorageFile(cachePath);
    const persistence = await ext.PersistenceCreator.createPersistence({
      cachePath,
      dataProtectionScope: ext.DataProtectionScope.CurrentUser,
      serviceName,
      accountName,
      usePlaintextFileOnLinux: false,
      loggerOptions: {piiLoggingEnabled: false, logLevel: LogLevel.Error, loggerCallback: () => {}},
    });
    if (!await persistence.verifyPersistence()) throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
    return Object.freeze({persistence, cachePlugin: new ext.PersistenceCachePlugin(persistence), directory});
  } catch {
    throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
  } finally {
    if (validationLock) {try {validationLock.release();} catch { /* no path logging */ }}
  }
}

const idPattern = /^[A-Za-z0-9_-]{8,128}$/;
function validateKey(key) {
  if (!key || !idPattern.test(key.accountId || '') || !/^[a-f0-9]{64}$/.test(key.scopeFingerprint || '') || !idPattern.test(key.checkpointId || '')) throw fixedError('INVALID_CURSOR_KEY');
}
function parseRecord(text, key) {
  if (text === null) return null;
  let row;
  try { row = JSON.parse(text); } catch { throw fixedError('INCOMPATIBLE_CURSOR_RECORD'); }
  if (!row || row.schemaVersion !== 1 || row.accountId !== key.accountId || row.scopeFingerprint !== key.scopeFingerprint || row.checkpointId !== key.checkpointId || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.revoked !== 'boolean') throw fixedError('INCOMPATIBLE_CURSOR_RECORD');
  if (row.revoked) { if (row.cursor !== null || row.cursorDigest !== null) throw fixedError('INCOMPATIBLE_CURSOR_RECORD'); }
  else if (typeof row.cursor !== 'string' || row.cursor.length < 1 || row.cursor.length > 32768 || !/^[a-f0-9]{64}$/.test(row.cursorDigest || '') || hash(row.cursor) !== row.cursorDigest) throw fixedError('INCOMPATIBLE_CURSOR_RECORD');
  return row;
}

// Persistence must be an OS-backed secret service. This wrapper stores only
// encrypted-at-rest values through the supplied trusted platform provider.
// The persistence provider's own lock path is used as the cross-process lock.
export function createProtectedCursorStore({persistenceFactory, lockFactory} = {}) {
  if (typeof persistenceFactory !== 'function' || typeof lockFactory !== 'function') throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
  const withKey = async (key, fn) => {
    validateKey(key);
    const persistence = await persistenceFactory(key);
    if (!persistence || typeof persistence.load !== 'function' || typeof persistence.save !== 'function' || typeof persistence.delete !== 'function' || typeof persistence.getFilePath !== 'function') throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
    const lockPath = persistence.getFilePath();
    if (typeof lockPath !== 'string' || !path.isAbsolute(lockPath)) throw fixedError('PROTECTED_BACKEND_UNAVAILABLE');
    return lockFactory(lockPath, async () => fn(persistence));
  };
  return Object.freeze({
    async inspect(key) {
      return withKey(key, async persistence => {
        const row = parseRecord(await persistence.load(), key);
        return row ? Object.freeze({schemaVersion: row.schemaVersion, revision: row.revision, hasCursor: !row.revoked, revoked: row.revoked}) : Object.freeze({schemaVersion: 1, revision: 0, hasCursor: false, revoked: false});
      });
    },
    async withCursor(key, use) {
      if (typeof use !== 'function') throw fixedError('INVALID_CURSOR_CALLBACK');
      return withKey(key, async persistence => {
        const row = parseRecord(await persistence.load(), key);
        return use(row && !row.revoked ? row.cursor : null, row?.revision ?? 0);
      });
    },
    async compareAndSwap(key, expectedRevision, cursor) {
      validateKey(key);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 32768) throw fixedError('INVALID_CURSOR_UPDATE');
      return withKey(key, async persistence => {
        const old = parseRecord(await persistence.load(), key);
        if (old && !old.revoked && old.cursor === cursor) return Object.freeze({revision: old.revision, replayed: true});
        if ((old?.revision ?? 0) !== expectedRevision) throw fixedError('STALE_CURSOR_REVISION');
        const next = {schemaVersion: 1, accountId: key.accountId, scopeFingerprint: key.scopeFingerprint, checkpointId: key.checkpointId, revision: expectedRevision + 1, revoked: false, cursor, cursorDigest: hash(cursor)};
        await persistence.save(JSON.stringify(next));
        return Object.freeze({revision: next.revision, replayed: false});
      });
    },
    async revoke(key, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fixedError('INVALID_CURSOR_UPDATE');
      return withKey(key, async persistence => {
        const old = parseRecord(await persistence.load(), key);
        if (old?.revoked) return Object.freeze({revision: old.revision, replayed: true});
        if ((old?.revision ?? 0) !== expectedRevision) throw fixedError('STALE_CURSOR_REVISION');
        const tombstone = {schemaVersion: 1, accountId: key.accountId, scopeFingerprint: key.scopeFingerprint, checkpointId: key.checkpointId, revision: expectedRevision + 1, revoked: true, cursor: null, cursorDigest: null};
        await persistence.save(JSON.stringify(tombstone));
        return Object.freeze({revision: tombstone.revision, replayed: false});
      });
    },
  });
}

export async function createOsProtectedCursorStore({repo, storageDir = path.join(os.homedir(), '.local/state/career-ops/outlook')} = {}) {
  const {withResourceLock} = await import('../../web/src/lib/scheduled-jobs-store.mjs');
  return createProtectedCursorStore({
    persistenceFactory: async key => {
      const accountName = `cursor_${hash(`${key.accountId}:${key.scopeFingerprint}:${key.checkpointId}`).slice(0, 48)}`;
      const result = await createMicrosoftProtectedPersistence({repo, storageDir, serviceName: 'CareerCentral-Outlook-Cursor', accountName});
      return result.persistence;
    },
    lockFactory: (resource, fn) => withResourceLock(resource, fn),
  });
}

export function newOpaqueMailboxId() { return `acct_${randomUUID().replaceAll('-', '')}`; }
