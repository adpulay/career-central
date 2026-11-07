// Validator for the explicit JSON Schema subset used by Career Central only.
// Diagnostics contain schema paths/categories, never rejected source values.
export function validateSchema(value, schema, registry = {}) {
  const errors = [];
  function check(v, s, p, document = schema) {
    if (s.$ref) {
      const target=s.$ref.startsWith('#/')?document:registry[s.$ref];
      if(!target){errors.push(p+':unsupported_ref');return;}
      return check(v,s.$ref.startsWith('#/')?target.$defs[s.$ref.split('/').at(-1)]:target,p,target);
    }
    if (s.anyOf) {
      if (s.anyOf.some(part => { const before = errors.length; check(v, part, p, document); const ok = errors.length === before; errors.length = before; return ok; })) return;
      errors.push(p + ':type'); return;
    }
    const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    if (s.type && !(s.type === type || s.type === 'integer' && type === 'number' && Number.isInteger(v))) { errors.push(p + ':type'); return; }
    if (type === 'number' && !Number.isFinite(v)) errors.push(p + ':finite');
    if (s.enum && !s.enum.includes(v)) errors.push(p + ':enum');
    if (type === 'string' && (s.maxLength && v.length > s.maxLength || s.pattern && !new RegExp(s.pattern).test(v))) errors.push(p + ':string');
    if (type === 'number' && (s.minimum !== undefined && v < s.minimum || s.maximum !== undefined && v > s.maximum)) errors.push(p + ':range');
    if (type === 'array') { if (v.length > (s.maxItems ?? 100000)) errors.push(p + ':length'); v.forEach((x, i) => check(x, s.items, p + '/' + i, document)); }
    if (type === 'object') {
      for (const k of s.required || []) if (!Object.hasOwn(v, k)) errors.push(p + '/' + k + ':required');
      for (const [k, x] of Object.entries(v)) {
        if (Object.hasOwn(s.properties || {}, k)) check(x, s.properties[k], p + '/' + k, document);
        else if (s.additionalProperties === false) errors.push(p + ':unexpected_property');
      }
    }
  }
  check(value, schema, '');
  return errors;
}
