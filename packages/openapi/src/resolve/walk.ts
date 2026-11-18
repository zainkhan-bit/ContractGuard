import {
  ROOT_POINTER,
  appendPointer,
  isCanonicalArray,
  isCanonicalObject,
  type CanonicalJson,
  type JsonPointer,
  type OasDialect,
} from '@zainkhan-bit/contractguard-core';

/** A `$ref` (or `$dynamicRef`) occurrence: the object at `site` contains the reference. */
export interface RefSite {
  readonly site: JsonPointer;
  readonly raw: string;
  readonly kind: 'ref' | 'dynamicRef';
  /** Base URI in effect at the site (3.1 `$id` re-basing applied). */
  readonly base: string;
  /** Other keys next to `$ref` (3.0 ignores them; 3.1 treats them as a conjunction for schemas). */
  readonly siblingKeys: readonly string[];
}

/** A 3.1 schema identifier: `$id` (absolute URI) or `$anchor`/`$dynamicAnchor` (URI with a plain-name fragment). */
export interface IdentifierSite {
  readonly uri: string;
  readonly pointer: JsonPointer;
}

export interface WalkResult {
  readonly refs: readonly RefSite[];
  readonly identifiers: readonly IdentifierSite[];
}

/** Keywords whose values are instance data, never references (§8.5). Only applies in keyword position. */
const DATA_KEYWORDS = new Set(['example', 'default', 'enum', 'const']);

/**
 * Keywords whose value is a map from user-chosen names to objects. Inside such maps, keys are
 * names (a response called "default", a property called "example" or "x-id"), never keywords.
 */
const NAME_MAP_KEYWORDS = new Set([
  'paths',
  'webhooks',
  'callbacks',
  'schemas',
  'responses',
  'parameters',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'pathItems',
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'content',
  'encoding',
  'variables',
  'mapping',
  'scopes',
]);

function stripFragment(uri: string): string {
  const hash = uri.indexOf('#');
  return hash === -1 ? uri : uri.slice(0, hash);
}

/**
 * Finds every reference and identifier in a document. Iterative and deterministic
 * (keys are visited in canonical order).
 */
export function walkReferences(value: CanonicalJson, documentUri: string, dialect: OasDialect): WalkResult {
  const refs: RefSite[] = [];
  const identifiers: IdentifierSite[] = [];
  interface Item {
    readonly node: CanonicalJson;
    readonly pointer: JsonPointer;
    readonly base: string;
    readonly inExamplesMap: boolean;
    /** The node is a name map: its keys are names, not keywords. */
    readonly inNameMap: boolean;
  }
  const stack: Item[] = [
    { node: value, pointer: ROOT_POINTER, base: documentUri, inExamplesMap: false, inNameMap: false },
  ];

  while (stack.length > 0) {
    const { node, pointer, base: inheritedBase, inExamplesMap, inNameMap } = stack.pop() as Item;
    if (isCanonicalArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push({
          node: node[i] as CanonicalJson,
          pointer: appendPointer(pointer, i),
          base: inheritedBase,
          inExamplesMap: false,
          inNameMap: false,
        });
      }
      continue;
    }
    if (!isCanonicalObject(node)) continue;

    let base = inheritedBase;
    if (dialect === 'oas31') {
      const id = node['$id'];
      if (typeof id === 'string') {
        try {
          base = stripFragment(new URL(id, inheritedBase).href);
          identifiers.push({ uri: base, pointer });
        } catch {
          // Invalid $id: ignored here; structural validation reports it.
        }
      }
      for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
        const anchor = node[keyword];
        if (typeof anchor === 'string' && anchor !== '') identifiers.push({ uri: `${base}#${anchor}`, pointer });
      }
    }

    const ref = node['$ref'];
    const dynamicRef = dialect === 'oas31' ? node['$dynamicRef'] : undefined;
    if (typeof ref === 'string' || typeof dynamicRef === 'string') {
      const siblingKeys = Object.keys(node).filter((k) => k !== '$ref' && k !== '$dynamicRef');
      refs.push({
        site: pointer,
        raw: typeof ref === 'string' ? ref : (dynamicRef as string),
        kind: typeof ref === 'string' ? 'ref' : 'dynamicRef',
        base,
        siblingKeys,
      });
    }

    const keys = Object.keys(node);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i] as string;
      const child = node[key] as CanonicalJson;
      if (inNameMap) {
        // Entry of a name map: the key is a user-chosen name; the value is an object to walk.
        stack.push({ node: child, pointer: appendPointer(pointer, key), base, inExamplesMap: false, inNameMap: false });
        continue;
      }
      if (key === '$ref' || key === '$dynamicRef' || DATA_KEYWORDS.has(key) || key.startsWith('x-')) continue;
      if (inExamplesMap && key === 'value') continue; // Example Object value is data
      if (key === 'examples') {
        // Schema `examples` (array) is data; Media/Parameter `examples` (map) holds Example/Reference objects.
        if (isCanonicalObject(child)) {
          const names = Object.keys(child);
          for (let j = names.length - 1; j >= 0; j--) {
            const name = names[j] as string;
            stack.push({
              node: child[name] as CanonicalJson,
              pointer: appendPointer(pointer, key, name),
              base,
              inExamplesMap: true,
              inNameMap: false,
            });
          }
        }
        continue;
      }
      stack.push({
        node: child,
        pointer: appendPointer(pointer, key),
        base,
        inExamplesMap: false,
        inNameMap: NAME_MAP_KEYWORDS.has(key) && isCanonicalObject(child),
      });
    }
  }
  return { refs, identifiers };
}
