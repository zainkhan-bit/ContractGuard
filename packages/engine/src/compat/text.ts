import type { ChangeSubject, RuleParams, SchemaPathSegment } from '@contractguard/core';

/** Human-readable schema path: `items[].address.zip`, `oneOf[Card].number`. */
export function schemaPathText(path: readonly SchemaPathSegment[]): string {
  let out = '';
  for (const s of path) {
    switch (s.kind) {
      case 'property':
        out += out === '' ? s.name : `.${s.name}`;
        break;
      case 'items':
        out += '[]';
        break;
      case 'additionalProperties':
        out += out === '' ? '{*}' : '.{*}';
        break;
      case 'variant':
        out += `${out === '' ? '' : '.'}${s.composition}[${s.matchKey}]`;
        break;
      case 'discriminatorMapping':
        out += `${out === '' ? '' : '.'}mapping[${s.value}]`;
        break;
    }
  }
  return out;
}

/** Where a change happened, in words: "response 200 (application/json) body at `items[].id`". */
export function describeSubject(subject: ChangeSubject & { readonly method?: string; readonly path?: string }): string {
  const site = subject.site;
  let where: string;
  switch (site.kind) {
    case 'operation':
      where = 'the operation';
      break;
    case 'servers':
      where = 'the server list';
      break;
    case 'security':
      where = subject.operationKey === undefined ? 'the security schemes' : 'the security requirements';
      break;
    case 'parameter':
      where = `${site.key.split(':')[0] ?? ''} parameter "${site.key.slice(site.key.indexOf(':') + 1)}"`;
      break;
    case 'requestBody':
      where = site.mediaType === undefined ? 'the request body' : `the request body (${site.mediaType})`;
      break;
    case 'response':
      where = site.mediaType === undefined ? `response ${site.status}` : `response ${site.status} (${site.mediaType})`;
      break;
    case 'responseHeader':
      where = `header "${site.header}" of response ${site.status}`;
      break;
  }
  const path = schemaPathText(subject.schemaPath);
  const op = subject.method !== undefined && subject.path !== undefined ? `${subject.method} ${subject.path}: ` : '';
  return `${op}${where}${path === '' ? '' : ` at \`${path}\``}`;
}

/** Replaces `{name}` placeholders; arrays are joined with ", ". Unknown placeholders are kept. */
export function interpolate(template: string, params: RuleParams): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}
