import path from 'node:path';
import {readPrivate} from './outlook-auth.mjs';

const fail = code => Object.assign(Error(code), {code});
export function validateGmailConfiguration(config) {
  const email = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (config?.schemaVersion !== 1 || config.provider !== 'gmail' || config.mode !== 'observe' ||
      config.automaticCodeUse !== false || config.automaticStatusChanges !== false ||
      !email(config.account) || config.account !== config.account.toLowerCase() || !email(config.applicationEmail) ||
      config.account === config.applicationEmail || !/^gmail_[a-f0-9]{32}$/.test(config.accountId || '') ||
      typeof config.clientFile !== 'string' || !path.isAbsolute(config.clientFile) ||
      !Array.isArray(config.rules) || config.rules.some(rule => typeof rule?.jobKey !== 'string' ||
        !rule.jobKey || !Array.isArray(rule.senders) || rule.senders.some(sender => !email(sender) || sender !== sender.toLowerCase()))) throw fail('INVALID_GMAIL_CONFIGURATION');
}
export function readGmailConfiguration(file) {
  let config;
  try {config = JSON.parse(readPrivate(file));} catch {throw fail('GMAIL_CONFIGURATION_UNAVAILABLE');}
  validateGmailConfiguration(config);
  return config;
}
