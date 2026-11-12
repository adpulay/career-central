import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOutlookReadiness} from '../lib/email/readiness.mjs';

const extensionLoader = async () => ({PersistenceCreator: {}, PersistenceCachePlugin: {}, DataProtectionScope: {}});
test('installed backend and service never imply vault validation or live authorization', async () => {
  const result = await inspectOutlookReadiness({platform: 'linux', env: {}, extensionLoader,
    run(command, args) {
      assert.equal(command, 'busctl');
      assert.ok(args.includes('--acquired'));
      return {status: 0, stdout: 'org.freedesktop.secrets 123 service user\n'};
    }});
  assert.equal(result.secretService, 'present');
  assert.equal(result.persistentBackendValidated, false);
  assert.equal(result.liveConnectionAuthorized, false);
  assert.deepEqual(result.blockers, ['OS_VAULT_ROUND_TRIP_NOT_VALIDATED']);
});
test('native loader and bus errors remain redacted and fail closed', async () => {
  const result = await inspectOutlookReadiness({platform: 'linux', env: {},
    extensionLoader: async () => { throw Error('PRIVATE_PATH_AND_SECRET'); },
    run: () => ({status: 1, stderr: 'PRIVATE_PATH_AND_SECRET'})});
  assert.equal(result.secretService, 'unknown');
  assert.ok(result.blockers.includes('NATIVE_EXTENSION_UNAVAILABLE'));
  assert.ok(result.blockers.includes('SECRET_SERVICE_NOT_CONFIRMED'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('Windows does not probe Linux services', async () => {
  const result = await inspectOutlookReadiness({platform: 'win32', env: {}, extensionLoader,
    run: () => { assert.fail('unexpected subprocess'); }});
  assert.equal(result.secretService, 'not-applicable');
  assert.equal(result.nativeExtension, 'loadable');
  assert.deepEqual(result.blockers, ['OS_VAULT_ROUND_TRIP_NOT_VALIDATED']);
});
test('unrelated service names do not satisfy the Secret Service requirement', async () => {
  const result = await inspectOutlookReadiness({platform: 'linux', env: {}, extensionLoader,
    run: () => ({status: 0, stdout: 'org.freedesktop.secrets.fake 123\n'})});
  assert.equal(result.secretService, 'absent');
});
