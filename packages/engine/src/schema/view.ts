import {
  InternalError,
  compareCodeUnits,
  jsonEquals,
  sha256Hex,
  type AdditionalProperties,
  type Bound,
  type CanonicalJson,
  type Discriminator,
  type JsonType,
  type PropertyEdge,
  type SchemaEdge,
  type SchemaGraph,
  type SchemaNode,
  type SchemaNodeId,
} from '@contractguard/core';
import { expandTypes } from './relations.js';

const ANY_ID = '~any' as SchemaNodeId;
const FINGERPRINT_DEPTH = 8;

/** True for nodes that stand for an unresolved reference (built by the normalizer with --allow-invalid-spec). */
export function isUnresolved(node: SchemaNode): boolean {
  return node.unsupported.some((u) => u.keyword.startsWith('$ref-unresolved:'));
}

/**
 * One side's schema graph, with lazily merged `allOf` views (§11.5), a synthetic unconstrained node
 * (used where a keyword is absent, e.g. `items`), and depth-limited structural fingerprints (§11.6).
 */
export class SchemaSide {
  readonly #graph: SchemaGraph;
  readonly #synthetic = new Map<SchemaNodeId, SchemaNode>();
  readonly #views = new Map<SchemaNodeId, SchemaNode>();
  readonly #fingerprints = new Map<SchemaNodeId, string>();

  constructor(graph: SchemaGraph) {
    this.#graph = graph;
  }

  /** The id of a synthetic `{}` node. */
  get anyId(): SchemaNodeId {
    if (!this.#synthetic.has(ANY_ID)) {
      this.#synthetic.set(ANY_ID, {
        ...blankNode(ANY_ID),
        trivial: 'any',
      });
    }
    return ANY_ID;
  }

  node(id: SchemaNodeId): SchemaNode {
    const n = this.#graph.nodes.get(id) ?? this.#synthetic.get(id);
    if (n === undefined) throw new InternalError(`Unknown schema node ${id}`);
    return n;
  }

  /** The node with mergeable `allOf` branches folded in; the node itself when not mergeable. */
  view(id: SchemaNodeId): SchemaNode {
    let v = this.#views.get(id);
    if (v === undefined) {
      this.#views.set(id, this.node(id)); // guards against allOf cycles
      v = this.#merge(this.node(id));
      this.#views.set(id, v);
    }
    return v;
  }

  #merge(n: SchemaNode): SchemaNode {
    if (n.composition.allOf.length === 0 || n.trivial !== undefined) return n;
    const branches = n.composition.allOf.map((e) => this.view(e.target));
    const own: SchemaNode = { ...n, composition: { ...n.composition, allOf: [], allOfOrigins: [] } };
    const parts = [own, ...branches].filter((p) => p.trivial !== 'any');
    const blocked = parts.some(
      (p) =>
        p.trivial === 'never' ||
        p.composition.allOf.length > 0 ||
        p.composition.anyOf.length > 0 ||
        p.composition.oneOf.length > 0 ||
        p.composition.not !== undefined ||
        p.unsupported.length > 0 ||
        p.array.prefixItems !== undefined ||
        p.object.patternProperties.size > 0,
    );
    if (blocked) return n;
    const merged = mergeParts(n, parts, (name, edges) => this.#syntheticAllOf(n, name, edges));
    return merged ?? n;
  }

  #syntheticAllOf(owner: SchemaNode, name: string, edges: readonly PropertyEdge[]): PropertyEdge {
    const id = `${owner.id}~allOf/${encodeURIComponent(name)}` as SchemaNodeId;
    if (!this.#synthetic.has(id)) {
      this.#synthetic.set(id, {
        ...blankNode(id),
        dialect: owner.dialect,
        source: (edges[0] as PropertyEdge).site,
        composition: {
          allOf: edges.map((e) => ({ target: e.target, ...(e.ref === undefined ? {} : { ref: e.ref }) })),
          allOfOrigins: edges.map(() => 'allOf'),
          anyOf: [],
          oneOf: [],
        },
      });
    }
    return { target: id, name, site: (edges[0] as PropertyEdge).site };
  }

  /** Depth-limited structural fingerprint of a node (refs are transparent; cycles are cut). */
  fingerprint(id: SchemaNodeId): string {
    let fp = this.#fingerprints.get(id);
    if (fp === undefined) {
      fp = sha256Hex(JSON.stringify(this.#shape(id, FINGERPRINT_DEPTH, new Set())));
      this.#fingerprints.set(id, fp);
    }
    return fp;
  }

  #shape(id: SchemaNodeId, depth: number, stack: Set<SchemaNodeId>): unknown {
    if (depth === 0 || stack.has(id)) return '…';
    stack.add(id);
    const v = this.view(id);
    const edge = (e: SchemaEdge | undefined): unknown =>
      e === undefined ? null : this.#shape(e.target, depth - 1, stack);
    const shape = {
      trivial: v.trivial ?? null,
      types: v.types === undefined ? null : [...v.types].sort(compareCodeUnits),
      nullable: v.nullability.allowsNull,
      enum: v.enumValues ?? null,
      numeric: v.numeric,
      string: v.string,
      array: {
        items: edge(v.array.items),
        prefix: v.array.prefixItems?.map(edge) ?? null,
        min: v.array.minItems ?? null,
        max: v.array.maxItems ?? null,
        unique: v.array.uniqueItems,
      },
      object: {
        properties: [...v.object.properties].map(([k, e]) => [k, edge(e)]),
        required: [...v.object.required],
        additional:
          v.object.additionalProperties.kind === 'schema'
            ? edge(v.object.additionalProperties.schema)
            : v.object.additionalProperties.kind,
        patterns: [...v.object.patternProperties].map(([k, e]) => [k, edge(e)]),
        min: v.object.minProperties ?? null,
        max: v.object.maxProperties ?? null,
      },
      composition: {
        allOf: v.composition.allOf.map(edge),
        anyOf: v.composition.anyOf.map(edge),
        oneOf: v.composition.oneOf.map(edge),
        not: edge(v.composition.not),
      },
      discriminator:
        v.discriminator === undefined
          ? null
          : { property: v.discriminator.propertyName, mapping: [...v.discriminator.mapping.keys()] },
      access: v.access,
      default: v.annotations.default ?? null,
      unsupported: v.unsupported.map((u) => [u.keyword, u.valueHash]),
    };
    stack.delete(id);
    return shape;
  }
}

function blankNode(id: SchemaNodeId): SchemaNode {
  return {
    id,
    dialect: 'oas31',
    source: { uri: '' as never, pointer: '#' as never },
    via: [],
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

/** A single value when all parts agree (or only one sets it); `conflict` when they disagree. */
function agree<T>(values: readonly (T | undefined)[], equal: (a: T, b: T) => boolean): T | undefined | 'conflict' {
  let out: T | undefined;
  for (const v of values) {
    if (v === undefined) continue;
    if (out === undefined) out = v;
    else if (!equal(out, v)) return 'conflict';
  }
  return out;
}

function tightest(bounds: readonly (Bound | undefined)[], side: 'min' | 'max'): Bound | undefined {
  let out: Bound | undefined;
  for (const b of bounds) {
    if (b === undefined) continue;
    if (out === undefined) {
      out = b;
      continue;
    }
    const c = b.value.compare(out.value);
    if ((side === 'min' ? c > 0 : c < 0) || (c === 0 && b.exclusive)) out = b;
  }
  return out;
}

function extreme(values: readonly (number | undefined)[], pick: 'max' | 'min'): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return undefined;
  return pick === 'max' ? Math.max(...defined) : Math.min(...defined);
}

/** Conjunction of allOf parts (§11.5). Returns undefined when the parts cannot be merged faithfully. */
function mergeParts(
  owner: SchemaNode,
  parts: readonly SchemaNode[],
  syntheticAllOf: (name: string, edges: readonly PropertyEdge[]) => PropertyEdge,
): SchemaNode | undefined {
  const same = (a: unknown, b: unknown): boolean => a === b;
  const sameNumber = (a: { equals: (x: never) => boolean }, b: unknown): boolean => a.equals(b as never);
  const sameEdge = (a: SchemaEdge, b: SchemaEdge): boolean => a.target === b.target;

  // Types: intersection (absent = all). Nullability: every part must allow null.
  let types: Set<JsonType> | undefined;
  for (const p of parts) {
    if (p.types === undefined) continue;
    const expanded = expandTypes(p.types);
    types = types === undefined ? new Set(expanded) : new Set([...types].filter((t) => expanded.has(t)));
  }
  const constrainsNull = parts.filter((p) => p.nullability.allowsNull !== 'unconstrained');
  const allowsNull: boolean | 'unconstrained' =
    constrainsNull.length === 0 ? 'unconstrained' : constrainsNull.every((p) => p.nullability.allowsNull === true);
  if (types !== undefined) {
    if (types.size === 0 && allowsNull !== true) return undefined; // contradictory: leave branch-wise
    if (types.has('number')) types.delete('integer');
    if (allowsNull === true) types.add('null');
  }

  // Enum: intersection.
  let enumValues: CanonicalJson[] | undefined;
  for (const p of parts) {
    if (p.enumValues === undefined) continue;
    enumValues =
      enumValues === undefined
        ? [...p.enumValues]
        : enumValues.filter((x) => p.enumValues?.some((y) => jsonEquals(x, y)));
  }

  const multipleOf = agree(
    parts.map((p) => p.numeric.multipleOf),
    sameNumber,
  );
  const numericFormat = agree(
    parts.map((p) => p.numeric.format),
    same,
  );
  const pattern = agree(
    parts.map((p) => p.string.pattern),
    same,
  );
  const stringFormat = agree(
    parts.map((p) => p.string.format),
    same,
  );
  const contentMediaType = agree(
    parts.map((p) => p.string.contentMediaType),
    same,
  );
  const contentEncoding = agree(
    parts.map((p) => p.string.contentEncoding),
    same,
  );
  const items = agree(
    parts.map((p) => p.array.items),
    sameEdge,
  );
  const discriminator = agree<Discriminator>(
    parts.map((p) => p.discriminator),
    (a, b) => a === b,
  );
  const additionalSchemas = agree(
    parts.map((p) =>
      p.object.additionalProperties.kind === 'schema' ? p.object.additionalProperties.schema : undefined,
    ),
    sameEdge,
  );
  const scalars = [
    multipleOf,
    numericFormat,
    pattern,
    stringFormat,
    contentMediaType,
    contentEncoding,
    items,
    discriminator,
    additionalSchemas,
  ];
  if (scalars.includes('conflict')) return undefined;

  // Properties: union; a name defined in several parts becomes a synthetic allOf of those definitions.
  const byName = new Map<string, PropertyEdge[]>();
  for (const p of parts) {
    for (const [name, edge] of p.object.properties) byName.set(name, [...(byName.get(name) ?? []), edge]);
  }
  const properties = new Map<string, PropertyEdge>(
    [...byName]
      .sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([name, edges]) => [name, edges.length === 1 ? (edges[0] as PropertyEdge) : syntheticAllOf(name, edges)]),
  );
  const required = new Set(parts.flatMap((p) => [...p.object.required]).sort(compareCodeUnits));
  const additionalProperties: AdditionalProperties = parts.some((p) => p.object.additionalProperties.kind === 'none')
    ? { kind: 'none', origin: 'explicit-false' }
    : additionalSchemas !== undefined
      ? { kind: 'schema', schema: additionalSchemas as SchemaEdge }
      : { kind: 'any', origin: 'default' };

  const minimum = tightest(
    parts.map((p) => p.numeric.minimum),
    'min',
  );
  const maximum = tightest(
    parts.map((p) => p.numeric.maximum),
    'max',
  );
  const minLength = extreme(
    parts.map((p) => p.string.minLength),
    'max',
  );
  const maxLength = extreme(
    parts.map((p) => p.string.maxLength),
    'min',
  );
  const minItems = extreme(
    parts.map((p) => p.array.minItems),
    'max',
  );
  const maxItems = extreme(
    parts.map((p) => p.array.maxItems),
    'min',
  );
  const minProperties = extreme(
    parts.map((p) => p.object.minProperties),
    'max',
  );
  const maxProperties = extreme(
    parts.map((p) => p.object.maxProperties),
    'min',
  );
  const opt = <K extends string, V>(key: K, value: V | undefined | 'conflict'): Partial<Record<K, V>> =>
    value === undefined || value === 'conflict' ? {} : ({ [key]: value } as Record<K, V>);
  const defaultValue = parts.find((p) => p.annotations.default !== undefined)?.annotations.default;

  return {
    id: `${owner.id}~merged` as SchemaNodeId,
    dialect: owner.dialect,
    source: owner.source,
    via: owner.via,
    ...(types === undefined ? {} : { types }),
    nullability: {
      allowsNull,
      origin: allowsNull === 'unconstrained' ? 'no-type' : allowsNull ? 'type-includes-null' : 'not-nullable',
    },
    ...(enumValues === undefined ? {} : { enumValues, enumOrigin: 'enum' as const }),
    numeric: {
      ...opt('minimum', minimum),
      ...opt('maximum', maximum),
      ...opt('multipleOf', multipleOf),
      ...opt('format', numericFormat),
    },
    string: {
      ...opt('minLength', minLength),
      ...opt('maxLength', maxLength),
      ...opt('pattern', pattern),
      ...opt('format', stringFormat),
      ...opt('contentMediaType', contentMediaType),
      ...opt('contentEncoding', contentEncoding),
    },
    array: {
      ...opt('items', items),
      ...opt('minItems', minItems),
      ...opt('maxItems', maxItems),
      uniqueItems: parts.some((p) => p.array.uniqueItems),
    },
    object: {
      properties,
      required,
      additionalProperties,
      patternProperties: new Map(),
      ...opt('minProperties', minProperties),
      ...opt('maxProperties', maxProperties),
    },
    composition: { allOf: [], allOfOrigins: [], anyOf: [], oneOf: [] },
    ...opt('discriminator', discriminator),
    access: { readOnly: parts.some((p) => p.access.readOnly), writeOnly: parts.some((p) => p.access.writeOnly) },
    annotations: {
      deprecated: parts.some((p) => p.annotations.deprecated),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(owner.annotations.title === undefined ? {} : { title: owner.annotations.title }),
    },
    unsupported: [],
    extensions: owner.extensions,
  };
}
