import {getCareerOpsRoot} from '../path-resolver.mjs';
import {inspectMailboxSyncRecovery, abandonInterruptedMailboxSync} from '../lib/email/sync-recovery.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: node scripts/outlook-sync-recovery.mjs status | abandon --run-id ID --expected-revision N --acknowledge-worker-stopped';
try {
  const root = getCareerOpsRoot();
  if (args.length === 1 && args[0] === 'status') {
    console.log(JSON.stringify(inspectMailboxSyncRecovery({root}), null, 2));
  } else if (args[0] === 'abandon') {
    const options = {};
    for (let i = 1; i < args.length; i++) {
      const flag = args[i];
      if (!['--run-id', '--expected-revision', '--acknowledge-worker-stopped'].includes(flag) || flag in options) throw Error('INVALID_ARGUMENTS');
      if (flag === '--acknowledge-worker-stopped') options[flag] = true;
      else {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('INVALID_ARGUMENTS');
        options[flag] = args[++i];
      }
    }
    const revision = options['--expected-revision'];
    if (!/^\d+$/.test(revision || '')) throw Error('INVALID_ARGUMENTS');
    console.log(JSON.stringify(await abandonInterruptedMailboxSync({root,
      runId: options['--run-id'], expectedRevision: Number(revision),
      workerStopped: options['--acknowledge-worker-stopped'] === true,
    }), null, 2));
  } else throw Error('INVALID_ARGUMENTS');
} catch (error) {
  // Never print raw provider, filesystem, ledger or user-input errors.
  const allowed = new Set(['WORKER_STOP_ACKNOWLEDGMENT_REQUIRED', 'INVALID_RECOVERY_REQUEST',
    'STALE_STATE_REVISION', 'SYNC_RECOVERY_CONTEXT_CONFLICT', 'LEGACY_MAILBOX_REVIEW_REQUIRED',
    'OPERATION_COMMIT_UNCERTAIN', 'RECEIVER_CLOCK_REGRESSION']);
  const code = allowed.has(error?.code) ? error.code : 'RECOVERY_UNAVAILABLE';
  console.error(JSON.stringify({error: code}));
  if (error?.message === 'INVALID_ARGUMENTS') console.error(usage);
  process.exitCode = 2;
}
