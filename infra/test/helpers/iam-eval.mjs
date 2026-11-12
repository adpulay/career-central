// Minimal IAM policy evaluator for offline regression tests. It models what these
// policies use: Allow/Deny, Action/NotAction, Resource/NotResource with `*`
// wildcards, and the condition operators below, including missing-key semantics
// (a positive operator on a missing key is false; a negated one is true;
// ForAllValues on a missing key is true). Decision: any explicit Deny in the
// identity policies, boundary or SCPs wins; otherwise an identity Allow is needed,
// and, when a boundary is set, a boundary Allow as well. SCPs only deny (the
// account keeps FullAWSAccess). This is a model, not IAM: AWS's own evaluation is
// checked in the dev account with Access Analyzer and the policy simulator.
export const SUPPORTED_OPERATORS = new Set(['StringEquals', 'StringNotEquals', 'StringLike', 'StringNotLike', 'ArnEquals', 'ArnNotEquals',
  'ArnLike', 'ArnNotLike', 'Bool', 'ForAllValues:StringEquals', 'ForAnyValue:StringEquals']);

const glob = (pattern, caseInsensitive) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, caseInsensitive ? 'i' : '');
const anyMatch = (patterns, value, ci) => [patterns].flat().some(p => glob(p, ci).test(value));

function lookup(context, key) {
  const found = Object.keys(context).find(k => k.toLowerCase() === key.toLowerCase());
  return found === undefined ? undefined : context[found];
}

function conditionHolds(condition = {}, context = {}) {
  for (const [operator, keys] of Object.entries(condition)) {
    if (!SUPPORTED_OPERATORS.has(operator)) throw Error(`unsupported operator in test model: ${operator}`);
    for (const [key, expected] of Object.entries(keys)) {
      const values = [expected].flat().map(String), actual = lookup(context, key);
      const negated = /Not(Equals|Like)$/.test(operator);
      if (actual === undefined) {if (operator.startsWith('ForAllValues:') || negated) continue; return false;}
      const actuals = [actual].flat().map(String);
      const like = /Like$/.test(operator);
      const eq = v => values.some(e => like ? glob(e, false).test(v) : e === v);
      let ok;
      if (operator === 'Bool') ok = actuals.every(v => values.includes(v));
      else if (operator === 'ForAllValues:StringEquals') ok = actuals.every(v => values.includes(v));
      else if (operator === 'ForAnyValue:StringEquals') ok = actuals.some(v => values.includes(v));
      else if (negated) ok = !actuals.some(eq);
      else ok = actuals.some(eq);
      if (!ok) return false;
    }
  }
  return true;
}

function statementApplies(s, {action, resource, context}) {
  const actionHit = s.Action ? anyMatch(s.Action, action, true) : !anyMatch(s.NotAction, action, true);
  if (!actionHit) return false;
  const resourceHit = s.Resource ? anyMatch(s.Resource, resource, false) : s.NotResource ? !anyMatch(s.NotResource, resource, false) : true;
  return resourceHit && conditionHolds(s.Condition, context);
}

const statements = docs => docs.flatMap(doc => doc.Statement);
export function evaluate({identity = [], boundary = null, scps = []}, request) {
  const req = {resource: '*', context: {}, ...request};
  const all = [...statements(identity), ...(boundary ? boundary.Statement : []), ...statements(scps)];
  if (all.some(s => s.Effect === 'Deny' && statementApplies(s, req))) return 'explicitDeny';
  if (!statements(identity).some(s => s.Effect === 'Allow' && statementApplies(s, req))) return 'implicitDeny';
  if (boundary && !boundary.Statement.some(s => s.Effect === 'Allow' && statementApplies(s, req))) return 'implicitDeny';
  return 'allowed';
}

// Resolves the CloudFormation intrinsics used in synthesized IAM policies (Ref,
// Fn::GetAtt, Fn::Join) against a map of logical ids to concrete names and ARNs.
export function resolveIntrinsics(value, names) {
  if (Array.isArray(value)) return value.map(v => resolveIntrinsics(v, names));
  if (value && typeof value === 'object') {
    if ('Ref' in value) return {'AWS::Partition': 'aws', 'AWS::Region': 'us-east-1', 'AWS::AccountId': names.account, 'AWS::URLSuffix': 'amazonaws.com'}[value.Ref] ?? names.byId[value.Ref].name;
    if ('Fn::GetAtt' in value) {const [id, attr] = value['Fn::GetAtt']; if (attr !== 'Arn') throw Error(`unexpected attribute ${attr}`); return names.byId[id].arn;}
    if ('Fn::Join' in value) {const [sep, parts] = value['Fn::Join']; return resolveIntrinsics(parts, names).join(sep);}
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveIntrinsics(v, names)]));
  }
  return value;
}
