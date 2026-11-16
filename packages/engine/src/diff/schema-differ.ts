import {
  compareCodeUnits,
  jsonEquals,
  type AdditionalProperties,
  type CompositionKind,
  type ConstraintKeyword,
  type ContractChange,
  type JsonType,
  type LocatedValue,
  type PropertyEdge,
  type SchemaEdge,
  type SchemaGraph,
  type SchemaNode,
  type SchemaNodeId,
  type SchemaPathSegment,
  type SetRelation,
  type TypeSetFact,
} from '@contractguard/core';
import {
  compareBound,
  compareLimit,
  compareMultipleOf,
  enumDifference,
  expandTypes,
  formatRelation,
  setRelation,
  typeAllowed,
  type ConstraintRelation,
} from '../schema/relations.js';
import { SchemaSide, isUnresolved } from '../schema/view.js';

type SchemaChange = Extract<ContractChange, { readonly kind: `schema.${string}` }>;
type WithoutSubject<C> = C extends ContractChange ? Omit<C, 'subject' | 'causeKey'> : never;

export interface Access {
  readonly readOnly: boolean;
  readonly writeOnly: boolean;
}

/** Access flags of the property a change or child concerns, per side (absent = property absent on that side). */
export interface PropertyAccess {
  readonly base?: Access;
  readonly candidate?: Access;
}

/** A perspective-neutral change found at one schema pair (§9.6). */
export type LocalChange = WithoutSubject<SchemaChange> & {
  /** Distinguishes changes of one kind at one definition (e.g. the property or keyword), for cause grouping. */
  readonly detail: string;
  readonly access?: PropertyAccess;
};

export interface PairChild {
  readonly segment: SchemaPathSegment;
  readonly pair: string;
  readonly access?: PropertyAccess;
}

export interface PairDelta {
  readonly key: string;
  readonly local: LocalChange[];
  readonly children: PairChild[];
  /** True when this pair or any pair reachable from it has local changes (set by `finalize`). */
  changed: boolean;
}

export interface SchemaDifferOptions {
  readonly maxSchemaPairs: number;
  /** Maximum branches per composition that are matched (§9.6); beyond that → compositionUnanalyzable. */
  readonly maxBranches?: number;
}

const NUMERIC: readonly JsonType[] = ['number', 'integer'];

function located(node: SchemaNode, value?: LocatedValue['value']): LocatedValue {
  return { ...(value === undefined ? {} : { value }), location: node.source, via: node.via };
}

function typeFact(node: SchemaNode): TypeSetFact {
  if (node.trivial === 'never') return { types: [] };
  if (node.trivial === 'any' || node.types === undefined) return { types: 'any' };
  return { types: [...node.types].filter((t) => t !== 'null').sort(compareCodeUnits) };
}

function allowsNull(node: SchemaNode): boolean {
  return node.trivial !== 'never' && node.nullability.allowsNull !== false;
}

function componentName(edge: SchemaEdge): string | undefined {
  const m = /^#\/components\/schemas\/([^/]+)$/.exec(edge.ref?.raw ?? '');
  return m?.[1]?.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * Compares schema pairs coinductively with a shared memo (§9.6). Call `compare` for every usage root,
 * then `finalize` once, then read deltas with `delta`.
 */
export class SchemaDiffer {
  readonly base: SchemaSide;
  readonly candidate: SchemaSide;
  readonly #memo = new Map<string, PairDelta>();
  readonly #options: SchemaDifferOptions;
  #finalized = false;

  constructor(base: SchemaGraph, candidate: SchemaGraph, options: SchemaDifferOptions) {
    this.base = new SchemaSide(base);
    this.candidate = new SchemaSide(candidate);
    this.#options = options;
  }

  get pairCount(): number {
    return this.#memo.size;
  }

  delta(key: string): PairDelta {
    return this.#memo.get(key) as PairDelta;
  }

  /** Compares a base node with a candidate node and returns the pair key. */
  compare(b: SchemaNodeId, c: SchemaNodeId): string {
    const key = `${b}|${c}`;
    if (this.#memo.has(key)) return key; // done or in progress (coinduction)
    const d: PairDelta = { key, local: [], children: [], changed: false };
    this.#finalized = false;
    if (this.#memo.size >= this.#options.maxSchemaPairs) {
      this.#memo.set(key, d);
      const B = this.base.node(b);
      const C = this.candidate.node(c);
      d.local.push({
        kind: 'schema.budgetExceeded',
        facts: { limit: 'maxSchemaPairs' },
        base: located(B),
        candidate: located(C),
        detail: 'maxSchemaPairs',
      });
      return key;
    }
    this.#memo.set(key, d);
    this.#comparePair(d, this.base.view(b), this.candidate.view(c));
    return key;
  }

  /** Marks every pair from which a local change is reachable (reverse reachability, linear time). */
  finalize(): void {
    if (this.#finalized) return;
    const parents = new Map<string, string[]>();
    for (const d of this.#memo.values()) {
      d.changed = false;
      for (const ch of d.children) {
        const list = parents.get(ch.pair);
        if (list === undefined) parents.set(ch.pair, [d.key]);
        else list.push(d.key);
      }
    }
    const queue = [...this.#memo.values()].filter((d) => d.local.length > 0).map((d) => d.key);
    for (const k of queue) (this.#memo.get(k) as PairDelta).changed = true;
    while (queue.length > 0) {
      const k = queue.pop() as string;
      for (const p of parents.get(k) ?? []) {
        const pd = this.#memo.get(p) as PairDelta;
        if (!pd.changed) {
          pd.changed = true;
          queue.push(p);
        }
      }
    }
    this.#finalized = true;
  }

  #comparePair(d: PairDelta, B: SchemaNode, C: SchemaNode): void {
    const push = (change: LocalChange): void => {
      d.local.push(change);
    };
    if (isUnresolved(B) || isUnresolved(C)) {
      const raw = (isUnresolved(C) ? C : B).unsupported[0]?.keyword.slice('$ref-unresolved:'.length) ?? '';
      push({
        kind: 'schema.unresolvedReference',
        facts: { raw },
        base: located(B),
        candidate: located(C),
        detail: raw,
      });
      return;
    }
    if (B.trivial !== undefined || C.trivial !== undefined) {
      if (B.trivial !== C.trivial) {
        const rank = (n: SchemaNode): number => (n.trivial === 'any' ? 2 : n.trivial === 'never' ? 0 : 1);
        const relation: SetRelation = rank(C) > rank(B) ? 'superset' : 'subset';
        push({
          kind: 'schema.typeChanged',
          facts: { from: typeFact(B), to: typeFact(C), relation },
          base: located(B),
          candidate: located(C),
          detail: 'trivial',
        });
      }
      return;
    }
    this.#types(B, C, push);
    this.#enum(B, C, push);
    // Keyword families are compared only where both sides admit the family's type; otherwise
    // the type change already describes the difference (§11.1 type-scoping).
    const both = (...family: readonly JsonType[]): boolean =>
      typeAllowed(B.types, ...family) && typeAllowed(C.types, ...family);
    if (both(...NUMERIC)) this.#numeric(B, C, push);
    if (both('string')) this.#string(B, C, push);
    if (both('array')) this.#array(d, B, C, push);
    if (both('object')) this.#object(d, B, C, push);
    this.#discriminator(B, C, push);
    if (!jsonEquals(B.annotations.default ?? null, C.annotations.default ?? null)) {
      push({
        kind: 'schema.defaultChanged',
        facts: {},
        base: located(B, B.annotations.default),
        candidate: located(C, C.annotations.default),
        detail: 'default',
      });
    }
    this.#unsupported(B, C, push);
    for (const kind of ['oneOf', 'anyOf', 'allOf'] as const) this.#composition(d, kind, B, C, push);
  }

  #types(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const relation = setRelation(expandTypes(B.types), expandTypes(C.types));
    if (relation !== 'equal') {
      push({
        kind: 'schema.typeChanged',
        facts: { from: typeFact(B), to: typeFact(C), relation },
        base: located(B),
        candidate: located(C),
        detail: 'type',
      });
    }
    const spelled = new Set(['oas30-nullable', 'type-includes-null']);
    if (
      allowsNull(B) &&
      allowsNull(C) &&
      B.nullability.origin !== C.nullability.origin &&
      spelled.has(B.nullability.origin) &&
      spelled.has(C.nullability.origin)
    ) {
      push({
        kind: 'schema.representationChanged',
        facts: { what: `nullability (${B.nullability.origin} → ${C.nullability.origin})` },
        base: located(B),
        candidate: located(C),
        detail: 'nullable-representation',
      });
    }
    if (allowsNull(B) !== allowsNull(C)) {
      push({
        kind: 'schema.nullabilityChanged',
        facts: { from: allowsNull(B), to: allowsNull(C) },
        base: located(B, allowsNull(B)),
        candidate: located(C, allowsNull(C)),
        detail: 'nullable',
      });
    }
  }

  #enum(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    if (B.enumValues === undefined && C.enumValues === undefined) return;
    const { removed, added } = enumDifference(B.enumValues ?? [], C.enumValues ?? []);
    const constrained = [B.enumValues !== undefined, C.enumValues !== undefined] as const;
    if (removed.length === 0 && added.length === 0 && constrained[0] === constrained[1]) return;
    push({
      kind: 'schema.enumChanged',
      facts: {
        removed,
        added,
        extensible: B.extensions.has('x-extensible-enum') || C.extensions.has('x-extensible-enum'),
        constrained,
      },
      base: located(B),
      candidate: located(C),
      detail: 'enum',
    });
  }

  #constraint(
    keyword: ConstraintKeyword,
    relation: ConstraintRelation | undefined,
    B: SchemaNode,
    C: SchemaNode,
    push: (c: LocalChange) => void,
  ): void {
    if (relation === undefined) return;
    push({
      kind: 'schema.constraintChanged',
      facts: { keyword, relation },
      base: located(B),
      candidate: located(C),
      detail: keyword,
    });
  }

  #format(
    from: string | undefined,
    to: string | undefined,
    B: SchemaNode,
    C: SchemaNode,
    push: (c: LocalChange) => void,
  ): void {
    const relation = formatRelation(from, to);
    if (relation === 'equal') return;
    push({
      kind: 'schema.formatChanged',
      facts: { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), relation },
      base: located(B, from),
      candidate: located(C, to),
      detail: 'format',
    });
  }

  #numeric(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const integerOnly = (n: SchemaNode): boolean => {
      const t = expandTypes(n.types);
      return t.size === 1 && t.has('integer');
    };
    const ints = integerOnly(B) && integerOnly(C);
    this.#constraint('minimum', compareBound(B.numeric.minimum, C.numeric.minimum, 'min', ints), B, C, push);
    this.#constraint('maximum', compareBound(B.numeric.maximum, C.numeric.maximum, 'max', ints), B, C, push);
    this.#constraint('multipleOf', compareMultipleOf(B.numeric.multipleOf, C.numeric.multipleOf), B, C, push);
    this.#format(B.numeric.format, C.numeric.format, B, C, push);
  }

  #string(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const s = B.string;
    const t = C.string;
    this.#constraint('minLength', compareLimit(s.minLength ?? 0, t.minLength ?? 0, 'min'), B, C, push);
    this.#constraint('maxLength', compareLimit(s.maxLength ?? Infinity, t.maxLength ?? Infinity, 'max'), B, C, push);
    if (s.pattern !== t.pattern) {
      push({
        kind: 'schema.patternChanged',
        facts: {
          ...(s.pattern === undefined ? {} : { from: s.pattern }),
          ...(t.pattern === undefined ? {} : { to: t.pattern }),
        },
        base: located(B, s.pattern),
        candidate: located(C, t.pattern),
        detail: 'pattern',
      });
    }
    this.#format(s.format, t.format, B, C, push);
    if (s.contentMediaType !== t.contentMediaType) this.#constraint('contentMediaType', 'incomparable', B, C, push);
    if (s.contentEncoding !== t.contentEncoding) this.#constraint('contentEncoding', 'incomparable', B, C, push);
  }

  #array(d: PairDelta, B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const a = B.array;
    const b = C.array;
    this.#constraint('minItems', compareLimit(a.minItems ?? 0, b.minItems ?? 0, 'min'), B, C, push);
    this.#constraint('maxItems', compareLimit(a.maxItems ?? Infinity, b.maxItems ?? Infinity, 'max'), B, C, push);
    if (a.uniqueItems !== b.uniqueItems)
      this.#constraint('uniqueItems', a.uniqueItems ? 'relaxed' : 'tightened', B, C, push);
    if (a.items !== undefined || b.items !== undefined) {
      const bi = a.items?.target ?? this.base.anyId;
      const ci = b.items?.target ?? this.candidate.anyId;
      d.children.push({ segment: { kind: 'items' }, pair: this.compare(bi, ci) });
    }
  }

  #object(d: PairDelta, B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const ob = B.object;
    const oc = C.object;
    const parentAdditionalProperties = { base: ob.additionalProperties.kind, candidate: oc.additionalProperties.kind };
    const hasUnevaluated = (n: SchemaNode): boolean =>
      n.object.patternProperties.size > 0 || n.unsupported.some((u) => u.keyword === 'unevaluatedProperties');
    const parentHasUnevaluatedProperties = hasUnevaluated(B) || hasUnevaluated(C);
    const access = (side: SchemaSide, e: PropertyEdge | undefined): Access | undefined =>
      e === undefined ? undefined : side.view(e.target).access;

    const names = [...new Set([...ob.properties.keys(), ...oc.properties.keys()])].sort(compareCodeUnits);
    for (const name of names) {
      const pb = ob.properties.get(name);
      const pc = oc.properties.get(name);
      const acc: PropertyAccess = {
        ...(pb === undefined ? {} : { base: access(this.base, pb) as Access }),
        ...(pc === undefined ? {} : { candidate: access(this.candidate, pc) as Access }),
      };
      if (pb !== undefined && pc !== undefined) {
        d.children.push({ segment: { kind: 'property', name }, pair: this.compare(pb.target, pc.target), access: acc });
        if (ob.required.has(name) !== oc.required.has(name)) {
          push({
            kind: 'schema.requiredChanged',
            facts: { property: name, from: ob.required.has(name), to: oc.required.has(name) },
            base: { value: ob.required.has(name), location: pb.site },
            candidate: { value: oc.required.has(name), location: pc.site },
            detail: `prop:${name}`,
            access: acc,
          });
        }
        const ab = acc.base as Access;
        const ac = acc.candidate as Access;
        if (ab.readOnly !== ac.readOnly || ab.writeOnly !== ac.writeOnly) {
          push({
            kind: 'schema.accessChanged',
            facts: {
              property: name,
              readOnly: [ab.readOnly, ac.readOnly],
              writeOnly: [ab.writeOnly, ac.writeOnly],
              requiredInBase: ob.required.has(name),
            },
            base: { location: pb.site },
            candidate: { location: pc.site },
            detail: `prop:${name}`,
          });
        }
      } else if (pb !== undefined) {
        push({
          kind: 'schema.propertyRemoved',
          facts: {
            property: name,
            required: ob.required.has(name),
            parentAdditionalProperties,
            parentHasUnevaluatedProperties,
          },
          base: { location: pb.site },
          candidate: located(C),
          detail: `prop:${name}`,
          access: acc,
        });
      } else if (pc !== undefined) {
        push({
          kind: 'schema.propertyAdded',
          facts: {
            property: name,
            required: oc.required.has(name),
            parentAdditionalProperties,
            parentHasUnevaluatedProperties,
          },
          base: located(B),
          candidate: { location: pc.site },
          detail: `prop:${name}`,
          access: acc,
        });
      }
    }
    // `required` entries without a property definition on either side.
    for (const name of [...new Set([...ob.required, ...oc.required])].sort(compareCodeUnits)) {
      if (ob.properties.has(name) || oc.properties.has(name)) continue;
      if (ob.required.has(name) !== oc.required.has(name)) {
        push({
          kind: 'schema.requiredChanged',
          facts: { property: name, from: ob.required.has(name), to: oc.required.has(name) },
          base: located(B, ob.required.has(name)),
          candidate: located(C, oc.required.has(name)),
          detail: `prop:${name}`,
        });
      }
    }
    this.#additional(d, B, C, ob.additionalProperties, oc.additionalProperties, push);
    this.#constraint('minProperties', compareLimit(ob.minProperties ?? 0, oc.minProperties ?? 0, 'min'), B, C, push);
    this.#constraint(
      'maxProperties',
      compareLimit(ob.maxProperties ?? Infinity, oc.maxProperties ?? Infinity, 'max'),
      B,
      C,
      push,
    );
  }

  #additional(
    d: PairDelta,
    B: SchemaNode,
    C: SchemaNode,
    ab: AdditionalProperties,
    ac: AdditionalProperties,
    push: (c: LocalChange) => void,
  ): void {
    if (ab.kind !== ac.kind) {
      push({
        kind: 'schema.additionalPropertiesChanged',
        facts: { from: ab.kind, to: ac.kind },
        base: located(B),
        candidate: located(C),
        detail: 'additionalProperties',
      });
    }
    if (ab.kind === 'schema' || ac.kind === 'schema') {
      if (ab.kind === 'none' || ac.kind === 'none') return; // the kind change says it all
      const bt = ab.kind === 'schema' ? ab.schema.target : this.base.anyId;
      const ct = ac.kind === 'schema' ? ac.schema.target : this.candidate.anyId;
      d.children.push({ segment: { kind: 'additionalProperties' }, pair: this.compare(bt, ct) });
    }
  }

  #discriminator(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const db = B.discriminator;
    const dc = C.discriminator;
    if (db === undefined && dc === undefined) return;
    // Mapping identity: the target's component name (or reference text), else its structure.
    const entries = (side: SchemaSide, m: ReadonlyMap<string, SchemaEdge> | undefined): Map<string, string> =>
      new Map(
        [...(m ?? new Map<string, SchemaEdge>())].map(([k, e]) => [
          k,
          componentName(e) ?? e.ref?.raw ?? side.fingerprint(e.target),
        ]),
      );
    const mb = entries(this.base, db?.mapping);
    const mc = entries(this.candidate, dc?.mapping);
    let removed: string[];
    let added: string[];
    if (db !== undefined && dc !== undefined && db.propertyName !== dc.propertyName) {
      removed = [...mb.keys()];
      added = [...mc.keys()];
    } else {
      removed = [...mb].filter(([k, fp]) => mc.get(k) !== fp).map(([k]) => k);
      added = [...mc].filter(([k, fp]) => mb.get(k) !== fp).map(([k]) => k);
    }
    const propertyChanged = db?.propertyName !== dc?.propertyName;
    if (removed.length === 0 && added.length === 0 && !propertyChanged) return;
    push({
      kind: 'schema.discriminatorMappingChanged',
      facts: { removed: removed.sort(compareCodeUnits), added: added.sort(compareCodeUnits) },
      base: located(B, db?.propertyName),
      candidate: located(C, dc?.propertyName),
      detail: 'discriminator',
    });
  }

  #unsupportedChange(keywords: readonly string[], B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    push({
      kind: 'schema.unsupportedChanged',
      facts: { keywords },
      base: located(B),
      candidate: located(C),
      detail: keywords.join(','),
    });
  }

  #unsupported(B: SchemaNode, C: SchemaNode, push: (c: LocalChange) => void): void {
    const map = (n: SchemaNode): Map<string, string> => new Map(n.unsupported.map((u) => [u.keyword, u.valueHash]));
    const mb = map(B);
    const mc = map(C);
    const changed = [...new Set([...mb.keys(), ...mc.keys()])]
      .filter((k) => mb.get(k) !== mc.get(k))
      .sort(compareCodeUnits);
    const fp = (side: SchemaSide, e: SchemaEdge | undefined): string | undefined =>
      e === undefined ? undefined : side.fingerprint(e.target);
    if (fp(this.base, B.composition.not) !== fp(this.candidate, C.composition.not) && !changed.includes('not')) {
      changed.push('not');
      changed.sort(compareCodeUnits);
    }
    if (changed.length > 0) this.#unsupportedChange(changed, B, C, push);
  }

  #composition(
    d: PairDelta,
    kind: CompositionKind,
    B: SchemaNode,
    C: SchemaNode,
    push: (c: LocalChange) => void,
  ): void {
    const bl = B.composition[kind];
    const cl = C.composition[kind];
    if (bl.length === 0 && cl.length === 0) return;
    const hasDiscriminator = B.discriminator !== undefined || C.discriminator !== undefined;
    const limit = this.#options.maxBranches ?? 64;
    if (bl.length > limit || cl.length > limit) {
      push({
        kind: 'schema.compositionUnanalyzable',
        facts: { reason: `more than ${limit} ${kind} branches` },
        base: located(B),
        candidate: located(C),
        detail: kind,
      });
      return;
    }
    const m = this.#matchBranches(bl, cl, B, C);
    for (const [i, j, matchKey] of m.pairs) {
      d.children.push({
        segment: { kind: 'variant', composition: kind, matchKey },
        pair: this.compare((bl[i] as SchemaEdge).target, (cl[j] as SchemaEdge).target),
      });
    }
    if (m.ambiguous) {
      push({
        kind: 'schema.compositionUnanalyzable',
        facts: { reason: `ambiguous ${kind} branch matching` },
        base: located(B),
        candidate: located(C),
        detail: kind,
      });
    }
    for (const i of m.removed) {
      const n = this.base.view((bl[i] as SchemaEdge).target);
      push({
        kind: 'schema.variantRemoved',
        facts: { composition: kind, hasDiscriminator },
        base: located(n),
        candidate: located(C),
        detail: `${kind}:${this.#branchKey(this.base, bl[i] as SchemaEdge, B, i)}`,
      });
    }
    for (const j of m.added) {
      const n = this.candidate.view((cl[j] as SchemaEdge).target);
      push({
        kind: 'schema.variantAdded',
        facts: { composition: kind, hasDiscriminator },
        base: located(B),
        candidate: located(n),
        detail: `${kind}:${this.#branchKey(this.candidate, cl[j] as SchemaEdge, C, j)}`,
      });
    }
  }

  #discriminatorValues(owner: SchemaNode, edge: SchemaEdge): string[] {
    const out: string[] = [];
    for (const [value, e] of owner.discriminator?.mapping ?? []) if (e.target === edge.target) out.push(value);
    return out.sort(compareCodeUnits);
  }

  #branchKey(side: SchemaSide, edge: SchemaEdge, owner: SchemaNode, index: number): string {
    return (
      this.#discriminatorValues(owner, edge)[0] ??
      componentName(edge) ??
      side.view(edge.target).annotations.title ??
      `#${index}`
    );
  }

  /** Deterministic branch matching (§11.6). */
  #matchBranches(
    bl: readonly SchemaEdge[],
    cl: readonly SchemaEdge[],
    B: SchemaNode,
    C: SchemaNode,
  ): { pairs: [number, number, string][]; removed: number[]; added: number[]; ambiguous: boolean } {
    const freeB = new Set(bl.map((_, i) => i));
    const freeC = new Set(cl.map((_, j) => j));
    const pairs: [number, number, string][] = [];
    const take = (i: number, j: number, key: string): void => {
      pairs.push([i, j, key]);
      freeB.delete(i);
      freeC.delete(j);
    };
    const byKey = (keyOf: (side: 'b' | 'c', e: SchemaEdge, idx: number) => string | undefined): void => {
      const index = new Map<string, number[]>();
      for (const j of freeC) {
        const k = keyOf('c', cl[j] as SchemaEdge, j);
        if (k !== undefined) index.set(k, [...(index.get(k) ?? []), j]);
      }
      for (const i of [...freeB]) {
        const k = keyOf('b', bl[i] as SchemaEdge, i);
        const js = k === undefined ? undefined : index.get(k)?.filter((j) => freeC.has(j));
        if (k !== undefined && js?.length === 1) take(i, js[0] as number, k);
      }
    };
    // 1. discriminator value, 2. component name, 3. title, 4. structural fingerprint.
    byKey((s, e) => this.#discriminatorValues(s === 'b' ? B : C, e)[0]);
    byKey((_, e) => componentName(e));
    byKey((s, e) => (s === 'b' ? this.base : this.candidate).view(e.target).annotations.title);
    for (const i of [...freeB]) {
      const fp = this.base.fingerprint((bl[i] as SchemaEdge).target);
      const js = [...freeC].filter((j) => this.candidate.fingerprint((cl[j] as SchemaEdge).target) === fp);
      if (js.length >= 1) take(i, js[0] as number, this.#branchKey(this.base, bl[i] as SchemaEdge, B, i));
    }
    // Branches with discriminator values on both sides are only paired when a value is shared.
    const compatible = (i: number, j: number): boolean => {
      const vb = this.#discriminatorValues(B, bl[i] as SchemaEdge);
      const vc = this.#discriminatorValues(C, cl[j] as SchemaEdge);
      return vb.length === 0 || vc.length === 0 || vb.some((v) => vc.includes(v));
    };
    // 5. sole remaining.
    if (freeB.size === 1 && freeC.size === 1) {
      const i = [...freeB][0] as number;
      const j = [...freeC][0] as number;
      if (compatible(i, j)) take(i, j, this.#branchKey(this.base, bl[i] as SchemaEdge, B, i));
    }
    // 6. similarity.
    let ambiguous = false;
    const features = (side: SchemaSide, e: SchemaEdge): Set<string> => {
      const v = side.view(e.target);
      return new Set([
        ...[...v.object.properties.keys()].map((p) => `p:${p}`),
        ...[...expandTypes(v.types)].map((t) => `t:${t}`),
        ...[...v.object.required].map((r) => `r:${r}`),
      ]);
    };
    for (const i of [...freeB].sort((x, y) => x - y)) {
      const fb = features(this.base, bl[i] as SchemaEdge);
      let best = -1;
      let bestJ: number[] = [];
      for (const j of [...freeC].sort((x, y) => x - y)) {
        if (!compatible(i, j)) continue;
        const fc = features(this.candidate, cl[j] as SchemaEdge);
        const union = new Set([...fb, ...fc]).size;
        const score = union === 0 ? 1 : [...fb].filter((x) => fc.has(x)).length / union;
        if (score > best) {
          best = score;
          bestJ = [j];
        } else if (score === best) bestJ.push(j);
      }
      if (best < 0.5) continue;
      if (bestJ.length > 1) {
        ambiguous = true;
        continue;
      }
      take(i, bestJ[0] as number, this.#branchKey(this.base, bl[i] as SchemaEdge, B, i));
    }
    pairs.sort((x, y) => x[0] - y[0]);
    return { pairs, removed: [...freeB].sort((x, y) => x - y), added: [...freeC].sort((x, y) => x - y), ambiguous };
  }
}
