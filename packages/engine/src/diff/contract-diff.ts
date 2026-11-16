import {
  compareCodeUnits,
  schemaPathKey,
  siteKey,
  type AnalysisLimits,
  type ApiContract,
  type ChangeSubject,
  type ContractChange,
  type Direction,
  type EffectiveSecurity,
  type Header,
  type LocatedValue,
  type MediaTypeContent,
  type MediaTypeKey,
  type Operation,
  type OperationKey,
  type Parameter,
  type ParameterValue,
  type PathSegment,
  type Response,
  type SchemaEdge,
  type SecurityAlternative,
  type SecurityScheme,
  type Server,
  type SourceRef,
  type StatusKey,
  type UsageSite,
} from '@contractguard/core';
import { projectUsage, type SchemaUsage } from './project.js';
import { SchemaDiffer } from './schema-differ.js';

export interface DiffOptions {
  readonly limits: Pick<AnalysisLimits, 'maxSchemaPairs'>;
}

export interface DiffResult {
  /** Sorted, deterministic, perspective-neutral changes. */
  readonly changes: readonly ContractChange[];
  /** Number of distinct schema pairs compared (for budgets and diagnostics). */
  readonly schemaPairs: number;
}

/** Facts of a change kind (distributive: several kinds can share one union member). */
type FactsOf<C, K> = C extends { readonly kind: infer CK; readonly facts: infer F }
  ? [K] extends [CK]
    ? F
    : never
  : never;
type Facts<K extends ContractChange['kind']> = FactsOf<ContractChange, K>;

function at(source: SourceRef | undefined, value?: LocatedValue['value'], via?: readonly SourceRef[]): LocatedValue {
  return {
    ...(value === undefined ? {} : { value }),
    ...(source === undefined ? {} : { location: source }),
    ...(via === undefined || via.length === 0 ? {} : { via }),
  };
}

/** Reading order of sites: operation-level first, then request, then responses (each status with its headers). */
function siteOrder(site: UsageSite): string {
  switch (site.kind) {
    case 'servers':
      return '0';
    case 'security':
      return '1';
    case 'operation':
      return '2';
    case 'parameter':
      return `3|${site.key}`;
    case 'requestBody':
      return `4|${site.mediaType ?? ''}`;
    case 'response':
      return `5|${site.status}|0|${site.mediaType ?? ''}`;
    case 'responseHeader':
      return `5|${site.status}|1|${site.header}`;
  }
}

/** Orders changes deterministically: operation, site, direction, schema path, kind, cause. */
export function sortChanges(changes: readonly ContractChange[]): ContractChange[] {
  // Keys are computed once per change (schema paths can be long), then compared.
  const keyed = changes.map((c) => ({
    c,
    k: [
      c.subject.operationKey ?? '',
      siteOrder(c.subject.site),
      siteKey(c.subject.site),
      c.subject.direction ?? '',
      schemaPathKey(c.subject.schemaPath),
      c.kind,
      c.causeKey,
    ],
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) {
      const c = compareCodeUnits(a.k[i] as string, b.k[i] as string);
      if (c !== 0) return c;
    }
    return 0;
  });
  return keyed.map((x) => x.c);
}

/** Compares two canonical contracts (§9.2). Pure and deterministic. */
export function diffContracts(base: ApiContract, candidate: ApiContract, options: DiffOptions): DiffResult {
  return new ContractDiff(base, candidate, options).run();
}

interface PendingUsage extends SchemaUsage {
  readonly pair: string;
}

class ContractDiff {
  readonly #out: ContractChange[] = [];
  readonly #usages: PendingUsage[] = [];
  readonly #differ: SchemaDiffer;
  /** Base security scheme key → candidate key, for schemes that were renamed (§9.4.4). */
  readonly #renamed = new Map<string, string>();

  constructor(
    private readonly B: ApiContract,
    private readonly C: ApiContract,
    options: DiffOptions,
  ) {
    this.#differ = new SchemaDiffer(B.schemas, C.schemas, { maxSchemaPairs: options.limits.maxSchemaPairs });
  }

  run(): DiffResult {
    this.#servers();
    this.#securitySchemes();
    this.#operations();
    this.#differ.finalize();
    for (const u of this.#usages) this.#out.push(...projectUsage(this.#differ, u.pair, u));
    return { changes: sortChanges(this.#out), schemaPairs: this.#differ.pairCount };
  }

  #emit<K extends ContractChange['kind']>(
    kind: K,
    subject: Partial<ChangeSubject> & { readonly site: UsageSite },
    base: LocatedValue,
    candidate: LocatedValue,
    facts: Facts<K>,
    detail = '',
  ): void {
    const full: ChangeSubject = { schemaPath: [], ...subject };
    this.#out.push({
      kind,
      subject: full,
      base,
      candidate,
      facts,
      causeKey: `${kind}|${full.operationKey ?? ''}|${siteKey(full.site)}|${detail}`,
    } as ContractChange);
  }

  #usage(operationKey: OperationKey, site: UsageSite, direction: Direction, b: SchemaEdge, c: SchemaEdge): void {
    this.#usages.push({ operationKey, site, direction, pair: this.#differ.compare(b.target, c.target) });
  }

  // ---------------------------------------------------------------- servers

  #servers(): void {
    const site: UsageSite = { kind: 'servers' };
    const cByUrl = new Map(this.C.servers.map((s) => [s.urlTemplate, s]));
    const cBasePaths = new Set(this.C.servers.map((s) => s.basePath));
    for (const sb of this.B.servers) {
      const sc = cByUrl.get(sb.urlTemplate);
      if (sc === undefined) {
        const kind = cBasePaths.has(sb.basePath) ? 'server.removed' : 'server.basePathChanged';
        this.#emit(kind, { site }, at(sb.source, sb.urlTemplate), at(undefined), {}, sb.urlTemplate);
        continue;
      }
      this.#serverVariables(sb, sc);
    }
  }

  #serverVariables(sb: Server, sc: Server): void {
    for (const [name, vb] of sb.variables) {
      const vc = sc.variables.get(name);
      const before = vb.enum;
      const after = vc?.enum;
      const narrowed = after !== undefined && (before === undefined || before.some((x) => !after.includes(x)));
      if (narrowed) {
        this.#emit(
          'server.variableEnumNarrowed',
          { site: { kind: 'servers' } },
          at(sb.source),
          at(sc.source),
          {},
          `${sb.urlTemplate}#${name}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------- security schemes

  #securitySchemes(): void {
    const site: UsageSite = { kind: 'security' };
    const B = this.B.securitySchemes;
    const C = this.C.securitySchemes;
    const removed = [...B.keys()].filter((k) => !C.has(k));
    const added = new Set([...C.keys()].filter((k) => !B.has(k)));
    for (const k of removed) {
      const fp = (B.get(k) as SecurityScheme).fingerprint;
      const matches = [...added].filter((a) => (C.get(a) as SecurityScheme).fingerprint === fp);
      if (matches.length === 1) {
        const to = matches[0] as string;
        added.delete(to);
        this.#renamed.set(k, to);
        this.#emit(
          'securityScheme.renamed',
          { site },
          at(B.get(k)?.source, k),
          at(C.get(to)?.source, to),
          { from: k, to },
          k,
        );
      }
    }
    for (const [k, sb] of B) {
      const sc = C.get(k);
      if (sc === undefined) continue;
      const fields = schemeFieldChanges(sb, sc);
      if (fields.length > 0) {
        this.#emit(
          'securityScheme.changed',
          { site },
          at(sb.source),
          at(sc.source),
          { scheme: k, fields, incompatible: sb.fingerprint !== sc.fingerprint },
          k,
        );
      }
    }
  }

  // ---------------------------------------------------------------- operations (§9.3)

  #operations(): void {
    const B = this.B.operations;
    const C = this.C.operations;
    const removed = [...B.keys()].filter((k) => !C.has(k));
    const added = [...C.keys()].filter((k) => !B.has(k));
    const hints = renameHints(B, C, removed, added);
    const hintedTargets = new Set([...hints.values()].map((h) => h.to));
    for (const [key, ob] of B) {
      const oc = C.get(key);
      if (oc !== undefined) this.#operation(ob, oc);
    }
    for (const key of removed) {
      const ob = B.get(key) as Operation;
      const hint = hints.get(key);
      const site: UsageSite = { kind: 'operation' };
      if (hint === undefined) {
        this.#emit('operation.removed', { operationKey: key, site }, at(ob.source, ob.path), at(undefined), {});
      } else {
        const oc = C.get(hint.to) as Operation;
        this.#emit(
          'operation.probableRename',
          { operationKey: key, site },
          at(ob.source, ob.path),
          at(oc.source, oc.path),
          { fromKey: key, toKey: hint.to, evidence: hint.evidence },
        );
      }
    }
    for (const key of added) {
      if (hintedTargets.has(key)) continue;
      const oc = C.get(key) as Operation;
      this.#emit(
        'operation.added',
        { operationKey: key, site: { kind: 'operation' } },
        at(undefined),
        at(oc.source, oc.path),
        {},
      );
    }
  }

  #operation(ob: Operation, oc: Operation): void {
    const op = ob.key;
    const site: UsageSite = { kind: 'operation' };
    if (ob.deprecated !== oc.deprecated) {
      this.#emit(
        'operation.deprecated',
        { operationKey: op, site },
        at(ob.source, ob.deprecated),
        at(oc.source, oc.deprecated),
        {
          deprecated: oc.deprecated,
        },
      );
    }
    if (ob.operationId !== undefined && oc.operationId !== undefined && ob.operationId !== oc.operationId) {
      this.#emit(
        'operation.operationIdChanged',
        { operationKey: op, site },
        at(ob.source, ob.operationId),
        at(oc.source, oc.operationId),
        {},
      );
    }
    const namesB = templateNames(ob.pathSegments);
    const namesC = templateNames(oc.pathSegments);
    namesB.forEach((from, i) => {
      const to = namesC[i];
      if (to !== undefined && to !== from) {
        this.#emit(
          'path.parameterRenamed',
          { operationKey: op, site },
          at(ob.source, from),
          at(oc.source, to),
          { position: i + 1, from, to },
          String(i + 1),
        );
      }
    });
    this.#parameters(ob, oc);
    this.#requestBody(ob, oc);
    this.#responses(ob, oc);
    this.#security(op, ob.security, oc.security, ob.source, oc.source);
    if (ob.hasCallbacks !== oc.hasCallbacks) {
      this.#emit(
        'schema.unsupportedChanged',
        { operationKey: op, site },
        at(ob.source),
        at(oc.source),
        { keywords: ['callbacks'] },
        'callbacks',
      );
    }
  }

  // ---------------------------------------------------------------- parameters (§9.4.1)

  #parameters(ob: Operation, oc: Operation): void {
    const op = ob.key;
    const removed = new Map<string, Parameter>();
    const added = new Map<string, Parameter>();
    const keys = [...new Set([...ob.parameters.keys(), ...oc.parameters.keys()])].sort(compareCodeUnits);
    for (const k of keys) {
      const pb = ob.parameters.get(k);
      const pc = oc.parameters.get(k);
      if (pb !== undefined && pc === undefined) removed.set(pb.name.toLowerCase(), pb);
      else if (pc !== undefined && pb === undefined) added.set(pc.name.toLowerCase(), pc);
      else if (pb !== undefined && pc !== undefined) {
        const site: UsageSite = { kind: 'parameter', key: pb.key };
        if (pb.required !== pc.required) {
          this.#emit(
            'parameter.requiredChanged',
            { operationKey: op, site },
            at(pb.source, pb.required),
            at(pc.source, pc.required),
            {
              from: pb.required,
              to: pc.required,
            },
          );
        }
        const fields = serializationChanges(pb, pc);
        if (fields.length > 0) {
          this.#emit('parameter.serializationChanged', { operationKey: op, site }, at(pb.source), at(pc.source), {
            fields,
          });
        }
        this.#valueUsage(op, site, 'request', pb.value, pc.value);
      }
    }
    for (const name of [...removed.keys()].sort(compareCodeUnits)) {
      const pc = added.get(name);
      if (pc === undefined) continue;
      const pb = removed.get(name) as Parameter;
      removed.delete(name);
      added.delete(name);
      this.#emit(
        'parameter.locationChanged',
        { operationKey: op, site: { kind: 'parameter', key: pb.key } },
        at(pb.source, pb.in),
        at(pc.source, pc.in),
        { fromIn: pb.in, toIn: pc.in, requiredAfter: pc.required },
      );
    }
    for (const pb of removed.values()) {
      this.#emit(
        'parameter.removed',
        { operationKey: op, site: { kind: 'parameter', key: pb.key } },
        at(pb.source, pb.name),
        at(undefined),
        {
          required: pb.required,
          in: pb.in,
        },
      );
    }
    for (const pc of added.values()) {
      this.#emit(
        'parameter.added',
        { operationKey: op, site: { kind: 'parameter', key: pc.key } },
        at(undefined),
        at(pc.source, pc.name),
        {
          required: pc.required,
          in: pc.in,
        },
      );
    }
  }

  #valueUsage(op: OperationKey, site: UsageSite, direction: Direction, vb: ParameterValue, vc: ParameterValue): void {
    const edge = (v: ParameterValue): SchemaEdge | undefined => (v.kind === 'schema' ? v.schema : v.content.schema);
    const b = edge(vb);
    const c = edge(vc);
    if (b !== undefined && c !== undefined) this.#usage(op, site, direction, b, c);
  }

  // ---------------------------------------------------------------- request body (§9.4.2)

  #requestBody(ob: Operation, oc: Operation): void {
    const op = ob.key;
    const rb = ob.requestBody;
    const rc = oc.requestBody;
    const site: UsageSite = { kind: 'requestBody' };
    if (rb === undefined && rc === undefined) return;
    if (rb === undefined) {
      this.#emit('requestBody.added', { operationKey: op, site }, at(undefined), at(rc?.source), {
        required: rc?.required ?? false,
      });
      return;
    }
    if (rc === undefined) {
      this.#emit('requestBody.removed', { operationKey: op, site }, at(rb.source), at(undefined), {
        required: rb.required,
      });
      return;
    }
    if (rb.required !== rc.required) {
      this.#emit(
        'requestBody.requiredChanged',
        { operationKey: op, site },
        at(rb.source, rb.required),
        at(rc.source, rc.required),
        {
          from: rb.required,
          to: rc.required,
        },
      );
    }
    this.#content(op, rb.content, rc.content, (mediaType) => ({ kind: 'requestBody', mediaType }), 'request', true);
  }

  #content(
    op: OperationKey,
    cb: ReadonlyMap<MediaTypeKey, MediaTypeContent>,
    cc: ReadonlyMap<MediaTypeKey, MediaTypeContent>,
    siteFor: (mt: MediaTypeKey) => UsageSite,
    direction: Direction,
    compareEncoding: boolean,
  ): void {
    const keys = [...new Set([...cb.keys(), ...cc.keys()])].sort(compareCodeUnits);
    for (const mt of keys) {
      const mb = cb.get(mt);
      const mc = cc.get(mt);
      const site = siteFor(mt);
      if (mb === undefined) {
        this.#emit('mediaType.added', { operationKey: op, site, direction }, at(undefined), at(mc?.source, mt), {
          mediaType: mt,
        });
      } else if (mc === undefined) {
        this.#emit('mediaType.removed', { operationKey: op, site, direction }, at(mb.source, mt), at(undefined), {
          mediaType: mt,
        });
      } else {
        if (mb.schema !== undefined || mc.schema !== undefined) {
          this.#usage(
            op,
            site,
            direction,
            mb.schema ?? { target: this.#differ.base.anyId },
            mc.schema ?? { target: this.#differ.candidate.anyId },
          );
        }
        if (compareEncoding && encodingSignature(mb) !== encodingSignature(mc)) {
          this.#emit(
            'schema.unsupportedChanged',
            { operationKey: op, site, direction },
            at(mb.source),
            at(mc.source),
            { keywords: ['encoding'] },
            'encoding',
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------- responses (§9.4.3)

  #responses(ob: Operation, oc: Operation): void {
    const op = ob.key;
    const keys = [...new Set([...ob.responses.keys(), ...oc.responses.keys()])].sort(compareCodeUnits);
    for (const k of keys) {
      const eb = ob.responses.get(k);
      const ec = oc.responses.get(k);
      const rb = eb ?? effectiveResponse(ob, k);
      const rc = ec ?? effectiveResponse(oc, k);
      const site: UsageSite = { kind: 'response', status: k };
      if (eb !== undefined && ec === undefined) {
        this.#emit(
          'response.removed',
          { operationKey: op, site, direction: 'response' },
          at(eb.source, k),
          at(rc?.source),
          { status: k, statusClass: eb.statusClass, ...(rc === undefined ? {} : { effectiveFallback: rc.status }) },
        );
      } else if (ec !== undefined && eb === undefined) {
        this.#emit(
          'response.added',
          { operationKey: op, site, direction: 'response' },
          at(rb?.source),
          at(ec.source, k),
          { status: k, statusClass: ec.statusClass, ...(rb === undefined ? {} : { effectiveFallback: rb.status }) },
        );
      }
      if (rb !== undefined && rc !== undefined) this.#response(op, k, rb, rc);
    }
  }

  #response(op: OperationKey, status: StatusKey, rb: Response, rc: Response): void {
    const names = [...new Set([...rb.headers.keys(), ...rc.headers.keys()])].sort(compareCodeUnits);
    for (const name of names) {
      const hb = rb.headers.get(name);
      const hc = rc.headers.get(name);
      const site: UsageSite = { kind: 'responseHeader', status, header: name };
      const subject = { operationKey: op, site, direction: 'response' as const };
      if (hb === undefined)
        this.#emit('header.added', subject, at(undefined), at((hc as Header).source, name), {
          required: (hc as Header).required,
        });
      else if (hc === undefined)
        this.#emit('header.removed', subject, at(hb.source, name), at(undefined), { required: hb.required });
      else {
        if (hb.required !== hc.required) {
          this.#emit('header.requiredChanged', subject, at(hb.source, hb.required), at(hc.source, hc.required), {
            from: hb.required,
            to: hc.required,
          });
        }
        this.#valueUsage(op, site, 'response', hb.value, hc.value);
      }
    }
    const site: UsageSite = { kind: 'response', status };
    if (rb.content.size > 0 && rc.content.size === 0) {
      this.#emit(
        'response.bodyRemoved',
        { operationKey: op, site, direction: 'response' },
        at(rb.source),
        at(rc.source),
        {},
      );
      return;
    }
    if (rb.content.size === 0 && rc.content.size > 0) {
      this.#emit(
        'response.bodyAdded',
        { operationKey: op, site, direction: 'response' },
        at(rb.source),
        at(rc.source),
        {},
      );
      return;
    }
    this.#content(
      op,
      rb.content,
      rc.content,
      (mediaType) => ({ kind: 'response', status, mediaType }),
      'response',
      false,
    );
  }

  // ---------------------------------------------------------------- security (§9.4.4)

  #security(
    op: OperationKey,
    sb: EffectiveSecurity,
    sc: EffectiveSecurity,
    bSource: SourceRef,
    cSource: SourceRef,
  ): void {
    const rename = (alt: SecurityAlternative): SecurityAlternative =>
      new Map([...alt].map(([k, v]) => [this.#renamed.get(k) ?? k, v]));
    const baseAlts = sb.alternatives.map(rename);
    const reverse = new Map([...this.#renamed].map(([b, c]) => [c, b]));
    const compatible = (candKey: string): boolean =>
      this.B.securitySchemes.get(reverse.get(candKey) ?? candKey)?.fingerprint ===
      this.C.securitySchemes.get(candKey)?.fingerprint;
    const satisfies = (c: SecurityAlternative, a: SecurityAlternative): boolean =>
      [...c].every(([scheme, scopes]) => {
        const held = a.get(scheme);
        return held !== undefined && [...scopes].every((s) => held.has(s)) && compatible(scheme);
      });

    const anonymousRemoved = sb.anonymousAllowed && !sc.anonymousAllowed;
    const unsatisfied = sc.anonymousAllowed
      ? []
      : baseAlts.flatMap((a, i) => (sc.alternatives.some((c) => satisfies(c, a)) ? [] : [i]));
    const scopeAdditions: { alternative: number; scheme: string; scopes: string[] }[] = [];
    for (const i of unsatisfied) {
      const a = baseAlts[i] as SecurityAlternative;
      for (const c of sc.alternatives) {
        if (c.size !== a.size || ![...c.keys()].every((k) => a.has(k))) continue;
        for (const [scheme, scopes] of c) {
          const extra = [...scopes].filter((s) => !(a.get(scheme) as ReadonlySet<string>).has(s));
          if (extra.length > 0) scopeAdditions.push({ alternative: i, scheme, scopes: extra.sort(compareCodeUnits) });
        }
      }
    }
    const signature = (anonymous: boolean, alts: readonly SecurityAlternative[]): string =>
      JSON.stringify([
        anonymous,
        alts
          .map((a) => [...a].map(([k, v]) => [k, [...v]]))
          .map((x) => JSON.stringify(x))
          .sort(compareCodeUnits),
      ]);
    const differs = signature(sb.anonymousAllowed, baseAlts) !== signature(sc.anonymousAllowed, sc.alternatives);
    if (!differs && unsatisfied.length === 0) return;
    const relaxed = unsatisfied.length === 0 && !anonymousRemoved;
    this.#emit(
      'security.alternativesChanged',
      { operationKey: op, site: { kind: 'security' } },
      at(sb.source ?? bSource),
      at(sc.source ?? cSource),
      { unsatisfiedBaseAlternatives: unsatisfied, scopeAdditions, anonymousRemoved, relaxed },
    );
  }
}

function templateNames(segments: readonly PathSegment[]): string[] {
  return segments.flatMap((s) => (s.kind === 'template' ? [s.name] : s.kind === 'mixed' ? [...s.names] : []));
}

/** Effective response for a status the operation does not declare: range (NXX), then default (§9.4.3). */
export function effectiveResponse(op: Operation, status: StatusKey): Response | undefined {
  if (/^\d{3}$/.test(status)) {
    const range = op.responses.get(`${status.charAt(0)}XX` as StatusKey);
    if (range !== undefined) return range;
  }
  return status === 'default' ? undefined : op.responses.get('default' as StatusKey);
}

function serializationChanges(
  pb: Parameter,
  pc: Parameter,
): ('style' | 'explode' | 'allowReserved' | 'contentMediaType')[] {
  const out: ('style' | 'explode' | 'allowReserved' | 'contentMediaType')[] = [];
  if (pb.serialization.style !== pc.serialization.style) out.push('style');
  if (pb.serialization.explode !== pc.serialization.explode) out.push('explode');
  if (pb.serialization.allowReserved !== pc.serialization.allowReserved) out.push('allowReserved');
  const mt = (v: ParameterValue): string | undefined => (v.kind === 'content' ? v.mediaType : undefined);
  if (mt(pb.value) !== mt(pc.value)) out.push('contentMediaType');
  return out;
}

function encodingSignature(m: MediaTypeContent): string {
  return JSON.stringify(
    [...m.encoding].map(([prop, e]) => [
      prop,
      e.contentType ?? null,
      e.serialization === undefined
        ? null
        : [e.serialization.style, e.serialization.explode, e.serialization.allowReserved],
      [...e.headers.keys()],
    ]),
  );
}

function schemeFieldChanges(b: SecurityScheme, c: SecurityScheme): string[] {
  if (b.type !== c.type) return ['type'];
  const out: string[] = [];
  const cmp = (field: string, x: unknown, y: unknown): void => {
    if (x !== y) out.push(field);
  };
  switch (b.type) {
    case 'apiKey': {
      const cc = c as typeof b;
      cmp('in', b.in, cc.in);
      cmp(
        'name',
        b.in === 'header' ? b.name.toLowerCase() : b.name,
        cc.in === 'header' ? cc.name.toLowerCase() : cc.name,
      );
      break;
    }
    case 'http': {
      const cc = c as typeof b;
      cmp('scheme', b.scheme, cc.scheme);
      cmp('bearerFormat', b.bearerFormat, cc.bearerFormat);
      break;
    }
    case 'oauth2': {
      const cc = c as typeof b;
      const kinds = [...new Set([...b.flows.keys(), ...cc.flows.keys()])].sort(compareCodeUnits);
      for (const k of kinds) {
        const fb = b.flows.get(k);
        const fc = cc.flows.get(k);
        if (fb === undefined || fc === undefined) {
          out.push(`flows.${k}`);
          continue;
        }
        cmp(`flows.${k}.authorizationUrl`, fb.authorizationUrl, fc.authorizationUrl);
        cmp(`flows.${k}.tokenUrl`, fb.tokenUrl, fc.tokenUrl);
        cmp(`flows.${k}.refreshUrl`, fb.refreshUrl, fc.refreshUrl);
        if ([...fb.scopes].some((s) => !fc.scopes.has(s))) out.push(`flows.${k}.scopes`);
      }
      break;
    }
    case 'openIdConnect':
      cmp('openIdConnectUrl', b.openIdConnectUrl, (c as typeof b).openIdConnectUrl);
      break;
    case 'mutualTLS':
      break;
  }
  return out;
}

/** Rename hints for removed operations (§9.3): operationId first, then case/trailing-slash near matches. */
function renameHints(
  B: ReadonlyMap<OperationKey, Operation>,
  C: ReadonlyMap<OperationKey, Operation>,
  removed: readonly OperationKey[],
  added: readonly OperationKey[],
): Map<OperationKey, { readonly to: OperationKey; readonly evidence: 'operationId' | 'structural' }> {
  const hints = new Map<OperationKey, { to: OperationKey; evidence: 'operationId' | 'structural' }>();
  const free = new Set(added);
  const idCount = (ops: ReadonlyMap<OperationKey, Operation>): Map<string, number> => {
    const m = new Map<string, number>();
    for (const o of ops.values())
      if (o.operationId !== undefined) m.set(o.operationId, (m.get(o.operationId) ?? 0) + 1);
    return m;
  };
  const idsB = idCount(B);
  const idsC = idCount(C);
  for (const kb of removed) {
    const ob = B.get(kb) as Operation;
    const id = ob.operationId;
    if (id === undefined || idsB.get(id) !== 1 || idsC.get(id) !== 1) continue;
    const kc = [...free].find((k) => C.get(k)?.operationId === id);
    if (kc !== undefined && (C.get(kc) as Operation).method === ob.method) {
      hints.set(kb, { to: kc, evidence: 'operationId' });
      free.delete(kc);
    }
  }
  const near = (k: string): string => k.toLowerCase().replace(/\/+$/, '');
  for (const kb of removed) {
    if (hints.has(kb)) continue;
    const matches = [...free].filter((kc) => near(kc) === near(kb));
    if (matches.length === 1) {
      hints.set(kb, { to: matches[0] as OperationKey, evidence: 'structural' });
      free.delete(matches[0] as OperationKey);
    }
  }
  return hints;
}
