import {createHash} from 'node:crypto';
import {runControlledMailboxSync} from './controlled-sync.mjs';
import {validateGmailConfiguration} from './gmail-configuration.mjs';
import {GmailReadClient} from './gmail-client.mjs';

export function runControlledGmailSync(options) {
  if (options.authorizeConnection !== true) throw Object.assign(Error('GMAIL_CONNECTION_NOT_AUTHORIZED'), {code: 'GMAIL_CONNECTION_NOT_AUTHORIZED'});
  validateGmailConfiguration(options.config);
  // Bind the opaque operational identity to both configured addresses. Editing
  // an address cannot silently reuse a previous mailbox checkpoint or ID space.
  const boundConfig = {...options.config, accountId: 'gmail_' + createHash('sha256')
    .update([options.config.accountId, options.config.account, options.config.applicationEmail].join('\0')).digest('hex').slice(0, 32)};
  return runControlledMailboxSync({...options, config: boundConfig, interactive: true, provider: 'gmail',
    clientFactory: options.clientFactory ?? (settings => new GmailReadClient(settings)),
    validateConfiguration: validateGmailConfiguration,
    // The authenticated transport remains Gmail. Matching uses the original MSN
    // recipient in intact redirected headers, never embedded forward-body claims.
    analysisConfig: {...options.config, requireOriginalDate: true, account: options.config.applicationEmail,
      messageKeyNamespace: `gmail:${boundConfig.accountId}`},
  });
}
