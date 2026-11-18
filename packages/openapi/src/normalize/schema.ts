import {
  type JsonNumber,
  ROOT_POINTER,
  appendPointer,
  compareCodeUnits,
  integerBound,
  shortHash,
  isCanonicalArray,
  isCanonicalObject,
  isJsonNumber,
  jsonEquals,
  parsePointer,
  schemaNodeId,
  sortUniqueJson,
  sortedMap,
  type AdditionalProperties,
  type AllOfOrigin,
  type Bound,
  type CanonicalJson,
  type CanonicalObject,
  type Discriminator,
  type JsonType,
  type NullabilityInfo,
  type PropertyEdge,
  type SchemaEdge,
  type SchemaNode,
  type SchemaNodeId,
  type SchemaReference,
  type SourceRef,
  type UnsupportedKeyword,
} from '@zainkhan-bit/contractguard-core';
import { followReferences } from '../resolve/follow.js';
import { siteKey, valueAt, type ResolvedReference } from '../resolve/resolver.js';
import { arrayAt, bool, child, count, extensions, objectAt, str, type Loc, type NormalizeContext } from './context.js';

const JSON_TYPE_NAMES = new Set<string>(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

/** Keywords recorded as unsupported (present but not analyzed semantically; N16). */
const UNSUPPORTED_31 = [
  'if',
  'then',
  'else',
  'not',
  'dependentSchemas',
  'dependentRequired',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'contains',
  'minContains',
  'maxContains',
  'prefixItems',
  'patternProperties',
  'contentSchema',
] as const;
const UNSUPPORTED_30 = ['not'] as const;

/** Keywords that do not change validation (a `$ref` with only these siblings is a plain reference). */
const ANNOTATION_KEYWORDS = new Set([
  'description',
  'summary',
  'title',
  'example',
  'examples',
  'externalDocs',
  'xml',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
  'default',
  '$schema',
  '$id',
  '$anchor',
  '$dynamicAnchor',
  '$defs',
  'definitions',
]);

/**
 * Builds the schema graph (§7.5, ADR-07). Nodes are identified by source location; `$ref`s
 * become edges. Construction uses a worklist, never recursion.
 */
export class SchemaGraphBuilder {
  readonly nodes: Map<SchemaNodeId, SchemaNode> = new Map<SchemaNodeId, SchemaNode>();
  readonly #pending: { readonly id: SchemaNodeId; readonly loc: Loc; readonly via: readonly SourceRef[] }[] = [];
  readonly #scheduled = new Set<SchemaNodeId>();

  constructor(private readonly ctx: NormalizeContext) {}

  /** Returns an edge to the schema at `loc`, scheduling the target node for construction. */
  edgeAt(loc: Loc): SchemaEdge {
    let current = loc;
    let ref: SchemaReference | undefined;
    const via: SourceRef[] = [];
    // Unwrap single-element allOf wrappers with no other semantics (N12), after following refs.
    for (let guard = 0; guard < 64; guard++) {
      const step = this.#followSchemaRef(current);
      if (step.kind === 'unresolved') return { target: this.#unresolvedNode(current, step.raw) };
      if (step.ref !== undefined) {
        ref ??= step.ref;
        via.push(...step.via);
      }
      current = step.loc;
      const raw = this.#raw(current);
      const allOf = raw !== undefined && isCanonicalObject(raw) ? arrayAt(raw, 'allOf') : undefined;
      if (
        raw !== undefined &&
        isCanonicalObject(raw) &&
        allOf?.length === 1 &&
        Object.keys(raw).every((k) => k === 'allOf' || ANNOTATION_KEYWORDS.has(k) || k.startsWith('x-'))
      ) {
        current = child(current, 'allOf', 0);
        continue;
      }
      break;
    }
    const id = schemaNodeId(current.uri, current.pointer);
    if (!this.#scheduled.has(id)) {
      this.#scheduled.add(id);
      this.#pending.push({ id, loc: current, via });
    }
    return ref === undefined ? { target: id } : { target: id, ref };
  }

  /** Builds every scheduled node (and the nodes they reference). */
  drain(): void {
    for (let item = this.#pending.shift(); item !== undefined; item = this.#pending.shift()) {
      if (!this.nodes.has(item.id)) this.nodes.set(item.id, this.#build(item.id, item.loc, item.via));
    }
  }

  #raw(loc: Loc): CanonicalJson | undefined {
    const doc = this.ctx.set.documents.get(loc.uri);
    return doc === undefined ? undefined : valueAt(doc.value, loc.pointer);
  }

  /**
   * Follows `$ref`s from a schema position. In 3.1, a `$ref` with semantic siblings is kept as a node
   * (the conjunction is built in #build); in 3.0, siblings are ignored (warned by the resolver).
   */
  #followSchemaRef(
    loc: Loc,
  ):
    | { readonly kind: 'ok'; readonly loc: Loc; readonly ref?: SchemaReference; readonly via: readonly SourceRef[] }
    | { readonly kind: 'unresolved'; readonly raw: string } {
    const r = this.ctx.set.references.get(siteKey(loc.uri, loc.pointer));
    if (r === undefined) return { kind: 'ok', loc, via: [] };
    if (this.ctx.dialect === 'oas31' && r.siblingKeys.some((k) => !ANNOTATION_KEYWORDS.has(k) && !k.startsWith('x-'))) {
      return { kind: 'ok', loc, via: [] };
    }
    if (r.status !== 'resolved') return { kind: 'unresolved', raw: r.raw };
    const followed = followReferences(this.ctx.set, loc, {
      maxRefHops: this.ctx.limits.maxRefHops,
      stopAtSiblings: this.ctx.dialect === 'oas31',
      ...(this.ctx.side === undefined ? {} : { side: this.ctx.side }),
    });
    if (followed.value === undefined) {
      this.ctx.pushUnique(followed.diagnostics);
      return { kind: 'unresolved', raw: this.#failingRef(r) };
    }
    const target = followed.value.location;
    return {
      kind: 'ok',
      loc: { uri: target.uri, pointer: target.pointer },
      ref: { raw: r.raw, resolved: target, site: r.site, kind: r.kind },
      via: followed.value.via,
    };
  }

  /** The raw text of the first reference in a chain that does not resolve (cycles: the starting one). */
  #failingRef(start: ResolvedReference): string {
    let r: ResolvedReference | undefined = start;
    const seen = new Set<string>();
    while (r?.status === 'resolved' && !seen.has(r.raw + r.target.pointer)) {
      seen.add(r.raw + r.target.pointer);
      r = this.ctx.set.references.get(siteKey(r.target.uri, r.target.pointer));
    }
    return r === undefined || r.status === 'resolved' ? start.raw : r.raw;
  }

  /** A synthetic unconstrained schema for parameters/headers that declare neither schema nor content. */
  anyNode(loc: Loc): SchemaNodeId {
    const id = `${schemaNodeId(loc.uri, loc.pointer)}~any` as SchemaNodeId;
    if (!this.nodes.has(id))
      this.nodes.set(id, { ...emptyNode(id, this.ctx.dialect, this.ctx.source(loc), []), trivial: 'any' });
    return id;
  }

  #unresolvedNode(loc: Loc, raw: string): SchemaNodeId {
    const id = `${schemaNodeId(loc.uri, loc.pointer)}~unresolved` as SchemaNodeId;
    if (!this.nodes.has(id)) {
      const source = this.ctx.source(loc);
      this.nodes.set(id, {
        ...emptyNode(id, this.ctx.dialect, source, []),
        trivial: 'any',
        unsupported: [{ keyword: `$ref-unresolved:${raw}`, valueHash: shortHash(raw, 16), source }],
      });
    }
    return id;
  }

  #build(id: SchemaNodeId, loc: Loc, via: readonly SourceRef[]): SchemaNode {
    const source = this.ctx.source(loc);
    const raw = this.#raw(loc);
    const base = emptyNode(id, this.ctx.dialect, source, via);
    if (typeof raw === 'boolean') {
      if (this.ctx.dialect === 'oas30')
        this.ctx.report('CGD-SPEC-005', 'Boolean schemas are not valid in OpenAPI 3.0', loc);
      return { ...base, trivial: raw ? 'any' : 'never' };
    }
    if (raw === undefined || !isCanonicalObject(raw)) {
      this.ctx.report('CGD-SPEC-005', 'Expected a schema object', loc);
      return { ...base, trivial: 'any' };
    }
    const o = raw;
    const dialect = this.ctx.dialect;

    // --- $ref with siblings (3.1): conjunction ---
    const allOf: SchemaEdge[] = [];
    const allOfOrigins: AllOfOrigin[] = [];
    const siteRef = this.ctx.set.references.get(siteKey(loc.uri, loc.pointer));
    if (dialect === 'oas31' && siteRef !== undefined) {
      if (siteRef.status === 'resolved') {
        const followed = followReferences(this.ctx.set, siteRef.target, {
          maxRefHops: this.ctx.limits.maxRefHops,
          stopAtSiblings: true,
        });
        const target = followed.value?.location ?? siteRef.target;
        const edge = this.edgeAt({ uri: target.uri, pointer: target.pointer });
        allOf.push({
          ...edge,
          ref: { raw: siteRef.raw, resolved: siteRef.target, site: siteRef.site, kind: siteRef.kind },
        });
      } else {
        allOf.push({ target: this.#unresolvedNode(loc, siteRef.raw) });
      }
      allOfOrigins.push('ref-sibling');
    }

    // --- type & nullability (N8) ---
    let types: Set<JsonType> | undefined;
    let nullableAdded = false;
    const rawType = o['type'];
    if (typeof rawType === 'string' && JSON_TYPE_NAMES.has(rawType)) types = new Set([rawType as JsonType]);
    else if (dialect === 'oas31' && rawType !== undefined && isCanonicalArray(rawType)) {
      types = new Set(rawType.filter((t): t is JsonType => typeof t === 'string' && JSON_TYPE_NAMES.has(t)));
    } else if (rawType !== undefined) this.ctx.report('CGD-SPEC-005', 'Invalid "type"', child(loc, 'type'));
    if (dialect === 'oas30' && bool(o, 'nullable') === true) {
      if (types === undefined) {
        this.ctx.report('CGD-SPEC-110', '"nullable: true" has no effect without "type"', child(loc, 'nullable'));
      } else {
        types.add('null');
        nullableAdded = true;
      }
    }

    // --- enum / const (N9) ---
    let enumValues: readonly CanonicalJson[] | undefined;
    let enumOrigin: SchemaNode['enumOrigin'];
    const rawEnum = arrayAt(o, 'enum');
    const hasConst = dialect === 'oas31' && Object.hasOwn(o, 'const');
    if (rawEnum !== undefined) {
      enumValues = sortUniqueJson(rawEnum);
      enumOrigin = 'enum';
    }
    if (hasConst) {
      const c = o['const'] as CanonicalJson;
      enumValues = enumValues === undefined ? [c] : enumValues.some((v) => jsonEquals(v, c)) ? [c] : [];
      enumOrigin = enumOrigin === undefined ? 'const' : 'both';
    }

    const nullability = nullabilityOf(types, enumValues, nullableAdded);

    // --- numeric bounds (N10) ---
    const integerOnly = types !== undefined && [...types].every((t) => t === 'integer' || t === 'null');
    const minimum = this.#bound(o, loc, 'minimum', 'exclusiveMinimum', 'min', integerOnly);
    const maximum = this.#bound(o, loc, 'maximum', 'exclusiveMaximum', 'max', integerOnly);
    const multipleOf = positiveNumber(o['multipleOf']);
    const format = str(o, 'format');
    const numericOnly =
      types !== undefined && [...types].filter((t) => t !== 'null').every((t) => t === 'number' || t === 'integer');

    // --- arrays ---
    let items: SchemaEdge | undefined;
    const rawItems = o['items'];
    if (rawItems !== undefined && (isCanonicalObject(rawItems) || typeof rawItems === 'boolean')) {
      const edge = this.edgeAt(child(loc, 'items'));
      if (!(edge.ref === undefined && isEmptySchema(rawItems))) items = edge;
    }
    const prefixItemsRaw = dialect === 'oas31' ? arrayAt(o, 'prefixItems') : undefined;
    const prefixItems = prefixItemsRaw?.map((_, i) => this.edgeAt(child(loc, 'prefixItems', i)));

    // --- objects ---
    const propsRaw = objectAt(o, 'properties');
    const properties: [string, PropertyEdge][] = [];
    for (const name of Object.keys(propsRaw ?? {})) {
      const propLoc = child(loc, 'properties', name);
      const edge = this.edgeAt(propLoc);
      properties.push([name, { ...edge, name, site: this.ctx.source(propLoc) }]);
    }
    const required = new Set(arrayAt(o, 'required')?.filter((x): x is string => typeof x === 'string') ?? []);
    const additionalProperties = this.#additional(o, loc);
    if (additionalProperties.kind === 'none') {
      for (const name of required) {
        if (!properties.some(([n]) => n === name) && allOf.length === 0 && arrayAt(o, 'allOf') === undefined) {
          this.ctx.report(
            'CGD-SEM-106',
            `Required property "${name}" is not defined and additionalProperties is false`,
            child(loc, 'required'),
          );
        }
      }
    }
    const patternRaw = dialect === 'oas31' ? objectAt(o, 'patternProperties') : undefined;
    const patternProperties = new Map<string, SchemaEdge>(
      Object.keys(patternRaw ?? {}).map((p) => [p, this.edgeAt(child(loc, 'patternProperties', p))]),
    );

    // --- composition ---
    (arrayAt(o, 'allOf') ?? []).forEach((_, i) => {
      allOf.push(this.edgeAt(child(loc, 'allOf', i)));
      allOfOrigins.push('allOf');
    });
    const anyOf = (arrayAt(o, 'anyOf') ?? []).map((_, i) => this.edgeAt(child(loc, 'anyOf', i)));
    const oneOf = (arrayAt(o, 'oneOf') ?? []).map((_, i) => this.edgeAt(child(loc, 'oneOf', i)));
    const notRaw = o['not'];
    const not =
      notRaw !== undefined && (isCanonicalObject(notRaw) || typeof notRaw === 'boolean')
        ? this.edgeAt(child(loc, 'not'))
        : undefined;

    // --- discriminator (N13) ---
    const discriminator = this.#discriminator(o, loc, [...oneOf, ...anyOf]);

    // --- unsupported (N16) ---
    const unsupported: UnsupportedKeyword[] = [];
    for (const keyword of dialect === 'oas31' ? UNSUPPORTED_31 : UNSUPPORTED_30) {
      if (Object.hasOwn(o, keyword)) {
        unsupported.push({
          keyword,
          valueHash: shortHash(o[keyword] as CanonicalJson, 16),
          source: this.ctx.source(child(loc, keyword)),
        });
      }
    }
    if (siteRef?.kind === 'dynamicRef')
      unsupported.push({ keyword: '$dynamicRef', valueHash: shortHash(siteRef.raw, 16), source });

    const defaultValue = o['default'];
    const title = str(o, 'title');
    const minLength = count(o, 'minLength');
    const minItems = count(o, 'minItems');
    const minProperties = count(o, 'minProperties');
    const maxLength = count(o, 'maxLength');
    const maxItems = count(o, 'maxItems');
    const maxProperties = count(o, 'maxProperties');
    const pattern = str(o, 'pattern');
    const contentMediaType = dialect === 'oas31' ? str(o, 'contentMediaType') : undefined;
    const contentEncoding = dialect === 'oas31' ? str(o, 'contentEncoding') : undefined;

    const node: SchemaNode = {
      ...base,
      ...(types === undefined ? {} : { types: new Set([...types].sort(compareCodeUnits)) }),
      nullability,
      ...(enumValues === undefined ? {} : { enumValues, ...(enumOrigin === undefined ? {} : { enumOrigin }) }),
      numeric: {
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        ...(multipleOf === undefined ? {} : { multipleOf }),
        ...(format !== undefined && numericOnly ? { format } : {}),
      },
      string: {
        ...(minLength === undefined || minLength === 0 ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
        ...(pattern === undefined ? {} : { pattern }),
        ...(format !== undefined && !numericOnly ? { format } : {}),
        ...(contentMediaType === undefined ? {} : { contentMediaType }),
        ...(contentEncoding === undefined ? {} : { contentEncoding }),
      },
      array: {
        ...(items === undefined ? {} : { items }),
        ...(prefixItems === undefined ? {} : { prefixItems }),
        ...(minItems === undefined || minItems === 0 ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
        uniqueItems: bool(o, 'uniqueItems') === true,
      },
      object: {
        properties: sortedMap(properties),
        required: new Set([...required].sort(compareCodeUnits)),
        additionalProperties,
        patternProperties,
        ...(minProperties === undefined || minProperties === 0 ? {} : { minProperties }),
        ...(maxProperties === undefined ? {} : { maxProperties }),
      },
      composition: { allOf, allOfOrigins, anyOf, oneOf, ...(not === undefined ? {} : { not }) },
      ...(discriminator === undefined ? {} : { discriminator }),
      access: { readOnly: bool(o, 'readOnly') === true, writeOnly: bool(o, 'writeOnly') === true },
      annotations: {
        deprecated: bool(o, 'deprecated') === true,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(title === undefined ? {} : { title }),
      },
      unsupported,
      extensions: extensions(o),
    };
    if (isTrivialAny(node)) return { ...node, trivial: 'any' };
    if (
      not !== undefined &&
      isEmptySchema(notRaw) &&
      Object.keys(o).every((k) => k === 'not' || ANNOTATION_KEYWORDS.has(k))
    ) {
      return { ...node, trivial: 'never' };
    }
    return node;
  }

  #bound(
    o: CanonicalObject,
    loc: Loc,
    inclusiveKey: 'minimum' | 'maximum',
    exclusiveKey: 'exclusiveMinimum' | 'exclusiveMaximum',
    side: 'min' | 'max',
    integerOnly: boolean,
  ): Bound | undefined {
    const inclusive = o[inclusiveKey];
    const exclusive = o[exclusiveKey];
    let bound: Bound | undefined;
    if (this.ctx.dialect === 'oas30') {
      if (exclusive !== undefined && typeof exclusive !== 'boolean') {
        this.ctx.report('CGD-SPEC-005', `"${exclusiveKey}" must be a boolean in OpenAPI 3.0`, child(loc, exclusiveKey));
      }
      if (isJsonNumber(inclusive)) bound = { value: inclusive, exclusive: exclusive === true };
    } else {
      const candidates: Bound[] = [];
      if (isJsonNumber(inclusive)) candidates.push({ value: inclusive, exclusive: false });
      if (isJsonNumber(exclusive)) candidates.push({ value: exclusive, exclusive: true });
      else if (typeof exclusive === 'boolean') {
        this.ctx.report('CGD-SPEC-005', `"${exclusiveKey}" must be a number in OpenAPI 3.1`, child(loc, exclusiveKey));
      }
      for (const c of candidates) bound = bound === undefined ? c : tighter(bound, c, side);
    }
    if (bound === undefined || !integerOnly || (!bound.exclusive && bound.value.isInteger)) return bound;
    // Integer normalization: x > 0.5 ≡ x ≥ 1; x > 3 ≡ x ≥ 4; x ≥ 0.5 ≡ x ≥ 1; x ≤ -0.5 ≡ x ≤ -1.
    return { value: integerBound(bound.value, side, bound.exclusive), exclusive: false };
  }

  #additional(o: CanonicalObject, loc: Loc): AdditionalProperties {
    const raw = o['additionalProperties'];
    if (raw === undefined) return { kind: 'any', origin: 'default' };
    if (raw === true) return { kind: 'any', origin: 'explicit-true' };
    if (raw === false) return { kind: 'none', origin: 'explicit-false' };
    if (isCanonicalObject(raw)) {
      const edge = this.edgeAt(child(loc, 'additionalProperties'));
      if (edge.ref === undefined && isEmptySchema(raw)) return { kind: 'any', origin: 'explicit-empty-schema' };
      return { kind: 'schema', schema: edge };
    }
    this.ctx.report('CGD-SPEC-005', 'Invalid "additionalProperties"', child(loc, 'additionalProperties'));
    return { kind: 'any', origin: 'default' };
  }

  #discriminator(o: CanonicalObject, loc: Loc, variants: readonly SchemaEdge[]): Discriminator | undefined {
    const d = objectAt(o, 'discriminator');
    const propertyName = d === undefined ? undefined : str(d, 'propertyName');
    if (d === undefined || propertyName === undefined) return undefined;
    const mapping = new Map<string, SchemaEdge>();
    // Implicit mapping: component name of each $ref'd variant (N13).
    for (const v of variants) {
      const m = /^#\/components\/schemas\/([^/]+)$/.exec(v.ref?.raw ?? '');
      if (m?.[1] !== undefined) mapping.set(m[1].replaceAll('~1', '/').replaceAll('~0', '~'), v);
    }
    const explicit = objectAt(d, 'mapping') ?? {};
    for (const key of Object.keys(explicit)) {
      const value = explicit[key];
      if (typeof value !== 'string') continue;
      const target = this.#mappingTarget(value, loc);
      if (target === undefined) {
        this.ctx.report(
          'CGD-SEM-005',
          `Discriminator mapping "${key}" points to a missing schema: ${value}`,
          child(loc, 'discriminator', 'mapping', key),
        );
        continue;
      }
      const edge = this.edgeAt(target);
      mapping.set(key, {
        ...edge,
        ref: {
          raw: value,
          resolved: this.ctx.source(target),
          site: this.ctx.source(child(loc, 'discriminator', 'mapping', key)),
          kind: 'ref',
        },
      });
    }
    return { propertyName, mapping: sortedMap([...mapping]) };
  }

  #mappingTarget(value: string, loc: Loc): Loc | undefined {
    let target: Loc;
    if (!value.includes('/') && !value.includes('#')) {
      target = { uri: this.ctx.set.root, pointer: appendPointer(ROOT_POINTER, 'components', 'schemas', value) };
    } else {
      let url: URL;
      try {
        url = new URL(value, loc.uri);
      } catch {
        return undefined;
      }
      const docUri = url.href.split('#')[0] as Loc['uri'];
      const pointer = parsePointer(decodeURIComponent(url.hash.slice(1)));
      if (pointer === undefined || !this.ctx.set.documents.has(docUri)) return undefined;
      target = { uri: docUri, pointer };
    }
    return this.#raw(target) === undefined ? undefined : target;
  }
}

function emptyNode(
  id: SchemaNodeId,
  dialect: SchemaNode['dialect'],
  source: SourceRef,
  via: readonly SourceRef[],
): SchemaNode {
  return {
    id,
    dialect,
    source,
    via,
    nullability: { allowsNull: 'unconstrained', origin: 'no-type' },
    numeric: {},
    string: {},
    array: { uniqueItems: false },
    object: {
      properties: new Map(),
      required: new Set(),
      additionalProperties: { kind: 'any', origin: 'default' },
      patternProperties: new Map(),
    },
    composition: { allOf: [], allOfOrigins: [], anyOf: [], oneOf: [] },
    access: { readOnly: false, writeOnly: false },
    annotations: { deprecated: false },
    unsupported: [],
    extensions: new Map(),
  };
}

function nullabilityOf(
  types: ReadonlySet<JsonType> | undefined,
  enumValues: readonly CanonicalJson[] | undefined,
  nullableAdded: boolean,
): NullabilityInfo {
  const enumHasNull = enumValues?.some((v) => v === null);
  if (types === undefined && enumValues === undefined) return { allowsNull: 'unconstrained', origin: 'no-type' };
  const typeAllows = types === undefined || types.has('null');
  const enumAllows = enumValues === undefined || enumHasNull === true;
  const allowsNull = typeAllows && enumAllows;
  if (!allowsNull) return { allowsNull: false, origin: 'not-nullable' };
  if (nullableAdded) return { allowsNull: true, origin: 'oas30-nullable' };
  if (types !== undefined) return { allowsNull: true, origin: 'type-includes-null' };
  return { allowsNull: true, origin: 'enum-includes-null' };
}

function positiveNumber(v: CanonicalJson | undefined): JsonNumber | undefined {
  return isJsonNumber(v) && v.sign > 0 ? v : undefined;
}

function tighter(a: Bound, b: Bound, side: 'min' | 'max'): Bound {
  const c = a.value.compare(b.value);
  if (c === 0) return a.exclusive ? a : b;
  return (side === 'min' ? c > 0 : c < 0) ? a : b;
}

function isEmptySchema(raw: CanonicalJson | undefined): boolean {
  if (raw === true) return true;
  if (raw === undefined || !isCanonicalObject(raw)) return false;
  return Object.keys(raw).every((k) => ANNOTATION_KEYWORDS.has(k) || k.startsWith('x-'));
}

function isTrivialAny(n: SchemaNode): boolean {
  return (
    n.types === undefined &&
    n.enumValues === undefined &&
    Object.keys(n.numeric).length === 0 &&
    Object.keys(n.string).length === 0 &&
    n.array.items === undefined &&
    n.array.prefixItems === undefined &&
    n.array.minItems === undefined &&
    n.array.maxItems === undefined &&
    !n.array.uniqueItems &&
    n.object.properties.size === 0 &&
    n.object.required.size === 0 &&
    n.object.additionalProperties.kind === 'any' &&
    n.object.patternProperties.size === 0 &&
    n.object.minProperties === undefined &&
    n.object.maxProperties === undefined &&
    n.composition.allOf.length === 0 &&
    n.composition.anyOf.length === 0 &&
    n.composition.oneOf.length === 0 &&
    n.composition.not === undefined &&
    n.discriminator === undefined &&
    n.unsupported.length === 0
  );
}
