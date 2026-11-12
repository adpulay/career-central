// Validated deployment configuration for the Career Central monitor stack.
// Every safety-relevant default is the conservative one: schedule disabled,
// live reads off, data retained, no fixtures outside dev.
const fail = message => {throw new Error(`Invalid Career Central infra config: ${message}`);};

export function monitorConfig(input = {}) {
  const c = {
    environment: input.environment ?? 'dev',
    account: input.account ?? undefined,
    region: input.region ?? undefined,
    budgetLimitUsd: Number(input.budgetLimitUsd ?? 5),
    budgetEmail: input.budgetEmail,
    logRetentionDays: Number(input.logRetentionDays ?? 14),
    scheduleEnabled: input.scheduleEnabled === true || input.scheduleEnabled === 'true',
    scheduleMinutes: Number(input.scheduleMinutes ?? 10),
    liveReads: input.liveReads === true || input.liveReads === 'true',
    fixtureSources: Array.isArray(input.fixtureSources) ? input.fixtureSources : String(input.fixtureSources ?? '').split(',').map(s => s.trim()).filter(Boolean),
    reservedConcurrency: input.reservedConcurrency === undefined || input.reservedConcurrency === '' ? undefined : Number(input.reservedConcurrency),
    confirmProduction: input.confirmProduction === true || input.confirmProduction === 'true',
    // Name of a pre-created customer-managed policy applied as the permissions
    // boundary of every role in the stack (infra/policies/dev-role-boundary.json).
    permissionsBoundaryName: input.permissionsBoundaryName || undefined,
    // false when an account-level budget created before any deployment already
    // guards the account (named by accountBudgetName); the stack then adds none.
    stackBudget: !(input.stackBudget === false || input.stackBudget === 'false'),
    accountBudgetName: input.accountBudgetName || undefined,
  };
  if (!c.stackBudget && !/^[A-Za-z0-9_.:-]{1,100}$/.test(c.accountBudgetName ?? '')) fail('stackBudget=false requires accountBudgetName (the pre-existing account budget that replaces it)');
  if (c.permissionsBoundaryName !== undefined && !/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(c.permissionsBoundaryName)) fail('permissionsBoundaryName must be an IAM policy name');
  if (!['dev', 'prod'].includes(c.environment)) fail('environment must be dev or prod');
  if (!Number.isFinite(c.budgetLimitUsd) || c.budgetLimitUsd <= 0 || c.budgetLimitUsd > 100) fail('budgetLimitUsd must be in (0, 100]');
  if (c.stackBudget && (typeof c.budgetEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.budgetEmail))) fail('budgetEmail is required (budget alerts are mandatory)');
  if (![1, 3, 5, 7, 14, 30, 60, 90].includes(c.logRetentionDays)) fail('logRetentionDays must be one of 1, 3, 5, 7, 14, 30, 60, 90');
  if (!Number.isInteger(c.scheduleMinutes) || c.scheduleMinutes < 5 || c.scheduleMinutes > 60) fail('scheduleMinutes must be an integer in [5, 60]');
  if (c.fixtureSources.length && c.environment !== 'dev') fail('fixtureSources are dev-only');
  if (c.fixtureSources.some(id => !/^[a-z0-9_-]{1,64}$/.test(id))) fail('fixtureSources must be source ids');
  if (c.reservedConcurrency !== undefined && !(Number.isInteger(c.reservedConcurrency) && c.reservedConcurrency >= 1 && c.reservedConcurrency <= 2)) fail('reservedConcurrency must be 1 or 2 when set');
  if (c.environment === 'prod' && (!c.confirmProduction || !/^\d{12}$/.test(c.account ?? '') || !c.region)) fail('prod requires confirmProduction=true and an explicit 12-digit account and region');
  if (c.account !== undefined && !/^\d{12}$/.test(c.account)) fail('account must be a 12-digit AWS account id');
  return Object.freeze(c);
}

// CDK context arrives as an object from cdk.json but as a JSON string from
// `cdk synth --context careerCentral='{...}'` (which replaces the cdk.json value).
export function contextConfig(value) {
  if (value === undefined || value === null) return monitorConfig({});
  if (typeof value === 'string') {
    let parsed; try {parsed = JSON.parse(value);} catch {fail('careerCentral context must be a JSON object');}
    value = parsed;
  }
  if (typeof value !== 'object' || Array.isArray(value)) fail('careerCentral context must be a JSON object');
  return monitorConfig(value);
}
