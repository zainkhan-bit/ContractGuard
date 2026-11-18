import {
  ROOT_POINTER,
  compareCodeUnits,
  erasePathTemplateNames,
  isCanonicalArray,
  isCanonicalObject,
  mediaTypeKey,
  operationKey,
  parameterKey,
  shortHash,
  sortedMap,
  statusClassOf,
  statusKey,
  stringifyCanonical,
  canonicalObject,
  type CanonicalJson,
  type CanonicalObject,
  type EffectiveSecurity,
  type EncodingSpec,
  type Header,
  type HttpMethod,
  type MediaTypeContent,
  type MediaTypeKey,
  type OAuthFlow,
  type OAuthFlowKind,
  type Operation,
  type OperationKey,
  type Parameter,
  type ParameterKey,
  type ParameterSerialization,
  type ParameterValue,
  type PathSegment,
  type RequestBody,
  type Response,
  type SecurityAlternative,
  type SecurityScheme,
  type SerializationStyle,
  type Server,
  type ServerVariable,
  type StatusKey,
} from '@zainkhan-bit/contractguard-core';
import {
  arrayAt,
  bool,
  child,
  extensions,
  objectAt,
  str,
  type Loc,
  type NormalizeContext,
  type Resolved,
} from './context.js';
import type { SchemaGraphBuilder } from './schema.js';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const PATH_ITEM_KEYS = new Set(['$ref', 'summary', 'description', 'servers', 'parameters', ...METHODS]);
/** Header parameters OpenAPI says to ignore (N3). */
const IGNORED_HEADER_PARAMS = new Set(['accept', 'content-type', 'authorization']);
const STYLES = new Set<string>(['matrix', 'label', 'simple', 'form', 'spaceDelimited', 'pipeDelimited', 'deepObject']);

/** Normalizes paths, operations, security and servers (§8.7 N1–N7). */
export class OperationNormalizer {
  readonly #operationIds = new Map<string, Loc>();

  constructor(
    private readonly ctx: NormalizeContext,
    private readonly schemas: SchemaGraphBuilder,
    private readonly securitySchemes: ReadonlyMap<string, SecurityScheme>,
    private readonly rootSecurity: { readonly value: readonly CanonicalJson[]; readonly loc: Loc } | undefined,
  ) {}

  operations(root: CanonicalObject, rootLoc: Loc): ReadonlyMap<OperationKey, Operation> {
    const paths = objectAt(root, 'paths') ?? {};
    const out: Operation[] = [];
    const templates = new Map<string, string>();
    for (const path of Object.keys(paths)) {
      const pathLoc = child(rootLoc, 'paths', path);
      if (!path.startsWith('/')) {
        this.ctx.report('CGD-SPEC-005', `Path "${path}" must start with "/"`, pathLoc);
        continue;
      }
      const erased = erasePathTemplateNames(path);
      const clash = templates.get(erased);
      if (clash !== undefined) {
        this.ctx.report('CGD-SEM-001', `Paths "${clash}" and "${path}" are equivalent templates`, pathLoc);
        continue;
      }
      templates.set(erased, path);
      const item = this.ctx.resolveObject(pathLoc, 'a path item');
      if (item === undefined) continue;
      out.push(...this.#pathItem(path, item));
    }
    out.sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.method, b.method));
    return new Map(out.map((o) => [o.key, o]));
  }

  #pathItem(path: string, item: Resolved<CanonicalObject>): Operation[] {
    for (const key of Object.keys(item.value)) {
      if (!PATH_ITEM_KEYS.has(key) && !key.startsWith('x-')) {
        this.ctx.report('CGD-SPEC-105', `Unknown key "${key}" in path item is ignored`, child(item.loc, key));
      }
    }
    const segments = pathSegments(path);
    const pathLevel = this.#parameterList(item.value, item.loc);
    const ops: Operation[] = [];
    for (const method of METHODS) {
      if (!Object.hasOwn(item.value, method)) continue;
      const op = this.ctx.resolveObject(child(item.loc, method), 'an operation');
      if (op !== undefined) ops.push(this.#operation(path, segments, method.toUpperCase(), op, pathLevel));
    }
    return ops;
  }

  #parameterList(owner: CanonicalObject, ownerLoc: Loc): Map<string, Resolved<CanonicalObject>> {
    const list = new Map<string, Resolved<CanonicalObject>>();
    (arrayAt(owner, 'parameters') ?? []).forEach((_, i) => {
      const p = this.ctx.resolveObject(child(ownerLoc, 'parameters', i), 'a parameter');
      if (p === undefined) return;
      const name = str(p.value, 'name');
      const location = str(p.value, 'in');
      if (name === undefined || location === undefined) {
        this.ctx.report('CGD-SPEC-005', 'Parameter needs "name" and "in"', p.loc);
        return;
      }
      list.set(`${location}:${location === 'header' ? name.toLowerCase() : name}`, p);
    });
    return list;
  }

  #operation(
    path: string,
    segments: readonly PathSegment[],
    method: HttpMethod,
    op: Resolved<CanonicalObject>,
    pathLevel: ReadonlyMap<string, Resolved<CanonicalObject>>,
  ): Operation {
    const key = operationKey(method, path);
    const o = op.value;
    const operationId = str(o, 'operationId');
    if (operationId !== undefined) {
      const previous = this.#operationIds.get(operationId);
      if (previous !== undefined)
        this.ctx.report('CGD-SEM-002', `Duplicate operationId "${operationId}"`, child(op.loc, 'operationId'));
      else this.#operationIds.set(operationId, op.loc);
    }

    // Parameters: path-item level merged with operation level; operation wins (N3).
    const merged = new Map(pathLevel);
    for (const [k, v] of this.#parameterList(o, op.loc)) merged.set(k, v);
    const parameters: [ParameterKey, Parameter][] = [];
    const templateNames = segments.flatMap((s) =>
      s.kind === 'template' ? [s.name] : s.kind === 'mixed' ? s.names : [],
    );
    const declaredPathParams = new Set<string>();
    for (const [, p] of [...merged].sort(([a], [b]) => compareCodeUnits(a, b))) {
      const param = this.#parameter(p, templateNames);
      if (param === undefined) continue;
      if (param.in === 'path') declaredPathParams.add(param.name);
      parameters.push([param.key, param]);
    }
    for (const name of templateNames) {
      if (!declaredPathParams.has(name)) {
        this.ctx.report(
          'CGD-SEM-003',
          `Path template variable "{${name}}" has no path parameter in ${method} ${path}`,
          op.loc,
        );
      }
    }

    const requestBody = Object.hasOwn(o, 'requestBody') ? this.#requestBody(child(op.loc, 'requestBody')) : undefined;
    const responses = this.#responses(o, op.loc);
    const hasCallbacks =
      objectAt(o, 'callbacks') !== undefined && Object.keys(objectAt(o, 'callbacks') ?? {}).length > 0;
    return {
      key,
      method,
      path,
      pathSegments: segments,
      ...(operationId === undefined ? {} : { operationId }),
      tags: (arrayAt(o, 'tags') ?? []).filter((t): t is string => typeof t === 'string'),
      deprecated: bool(o, 'deprecated') === true,
      parameters: new Map(parameters.sort(([a], [b]) => compareCodeUnits(a, b))),
      ...(requestBody === undefined ? {} : { requestBody }),
      responses,
      security: this.#security(o, op.loc),
      extensions: extensions(o),
      hasCallbacks,
      source: op.source,
      via: op.via,
    };
  }

  #parameter(p: Resolved<CanonicalObject>, templateNames: readonly string[]): Parameter | undefined {
    const o = p.value;
    const name = str(o, 'name') as string;
    const location = str(o, 'in') as string;
    if (location === 'header' && IGNORED_HEADER_PARAMS.has(name.toLowerCase())) {
      this.ctx.report('CGD-SPEC-106', `Header parameter "${name}" is ignored by OpenAPI`, p.loc);
      return undefined;
    }
    let position: number | undefined;
    if (location === 'path') {
      const index = templateNames.indexOf(name);
      if (index === -1) {
        this.ctx.report('CGD-SEM-003', `Path parameter "${name}" does not appear in the path template`, p.loc);
        return undefined;
      }
      position = index + 1;
    }
    const value = this.#parameterValue(o, p.loc);
    if (value === undefined) return undefined;
    return {
      key: parameterKey(location, name, position),
      name,
      in: location,
      required: location === 'path' ? true : bool(o, 'required') === true,
      deprecated: bool(o, 'deprecated') === true,
      allowEmptyValue: bool(o, 'allowEmptyValue') === true,
      serialization: serialization(o, location),
      value,
      source: p.source,
      via: p.via,
    };
  }

  #parameterValue(o: CanonicalObject, loc: Loc): ParameterValue | undefined {
    if (Object.hasOwn(o, 'schema')) return { kind: 'schema', schema: this.schemas.edgeAt(child(loc, 'schema')) };
    const content = objectAt(o, 'content');
    const first = content === undefined ? undefined : Object.keys(content)[0];
    if (content !== undefined && first !== undefined) {
      const mt = mediaTypeKey(first);
      const media = this.#mediaType(child(loc, 'content', first), mt ?? (first as MediaTypeKey));
      if (media !== undefined) return { kind: 'content', mediaType: media.mediaType, content: media };
    }
    // No schema or content: any value is allowed.
    return { kind: 'schema', schema: { target: this.schemas.anyNode(loc) } };
  }

  #requestBody(loc: Loc): RequestBody | undefined {
    const rb = this.ctx.resolveObject(loc, 'a request body');
    if (rb === undefined) return undefined;
    return {
      required: bool(rb.value, 'required') === true,
      content: this.#content(rb.value, rb.loc),
      source: rb.source,
      via: rb.via,
    };
  }

  #content(owner: CanonicalObject, ownerLoc: Loc): ReadonlyMap<MediaTypeKey, MediaTypeContent> {
    const content = objectAt(owner, 'content') ?? {};
    const out: [MediaTypeKey, MediaTypeContent][] = [];
    const seen = new Set<string>();
    for (const raw of Object.keys(content)) {
      const key = mediaTypeKey(raw);
      const loc = child(ownerLoc, 'content', raw);
      if (key === undefined) {
        // Not a media type at all (e.g. `examples` misplaced into `content`): it describes no format a consumer
        // could use, so it is ignored with a warning instead of rejecting the whole document.
        this.ctx.report('CGD-SPEC-107', `"${raw}" is not a media type; the entry is ignored`, loc);
        continue;
      }
      if (seen.has(key)) {
        this.ctx.report('CGD-SPEC-005', `Media type "${raw}" duplicates another entry after normalization`, loc);
        continue;
      }
      seen.add(key);
      const media = this.#mediaType(loc, key);
      if (media !== undefined) out.push([key, media]);
    }
    return sortedMap(out) as ReadonlyMap<MediaTypeKey, MediaTypeContent>;
  }

  #mediaType(loc: Loc, key: MediaTypeKey): MediaTypeContent | undefined {
    const m = this.ctx.resolveObject(loc, 'a media type');
    if (m === undefined) return undefined;
    const encodingRaw = objectAt(m.value, 'encoding') ?? {};
    const encoding: [string, EncodingSpec][] = [];
    for (const prop of Object.keys(encodingRaw)) {
      const e = this.ctx.resolveObject(child(m.loc, 'encoding', prop), 'an encoding');
      if (e === undefined) continue;
      const contentType = str(e.value, 'contentType');
      const hasSerialization = ['style', 'explode', 'allowReserved'].some((k) => Object.hasOwn(e.value, k));
      encoding.push([
        prop,
        {
          ...(contentType === undefined ? {} : { contentType }),
          headers: this.#headers(e.value, e.loc),
          ...(hasSerialization ? { serialization: serialization(e.value, 'query') } : {}),
          source: e.source,
          via: e.via,
        },
      ]);
    }
    return {
      mediaType: key,
      ...(Object.hasOwn(m.value, 'schema') ? { schema: this.schemas.edgeAt(child(m.loc, 'schema')) } : {}),
      encoding: sortedMap(encoding),
      source: m.source,
      via: m.via,
    };
  }

  #responses(o: CanonicalObject, opLoc: Loc): ReadonlyMap<StatusKey, Response> {
    const raw = objectAt(o, 'responses') ?? {};
    const out: [StatusKey, Response][] = [];
    for (const code of Object.keys(raw)) {
      const loc = child(opLoc, 'responses', code);
      if (code.startsWith('x-')) continue;
      const status = statusKey(code);
      if (status === undefined) {
        this.ctx.report('CGD-SPEC-005', `Invalid response status "${code}"`, loc);
        continue;
      }
      if (out.some(([s]) => s === status)) {
        this.ctx.report('CGD-SPEC-005', `Response "${code}" duplicates another entry after normalization`, loc);
        continue;
      }
      const r = this.ctx.resolveObject(loc, 'a response');
      if (r === undefined) continue;
      out.push([
        status,
        {
          status,
          statusClass: statusClassOf(status),
          headers: this.#headers(r.value, r.loc),
          content: this.#content(r.value, r.loc),
          source: r.source,
          via: r.via,
        },
      ]);
    }
    return sortedMap(out) as ReadonlyMap<StatusKey, Response>;
  }

  #headers(owner: CanonicalObject, ownerLoc: Loc): ReadonlyMap<string, Header> {
    const raw = objectAt(owner, 'headers') ?? {};
    const out: [string, Header][] = [];
    for (const name of Object.keys(raw)) {
      const lower = name.toLowerCase();
      if (lower === 'content-type') continue; // ignored per OAS (N6)
      const h = this.ctx.resolveObject(child(ownerLoc, 'headers', name), 'a header');
      if (h === undefined) continue;
      const value = this.#parameterValue(h.value, h.loc);
      if (value === undefined) continue;
      out.push([
        lower,
        {
          name,
          required: bool(h.value, 'required') === true,
          deprecated: bool(h.value, 'deprecated') === true,
          value,
          source: h.source,
          via: h.via,
        },
      ]);
    }
    return sortedMap(out);
  }

  #security(o: CanonicalObject, opLoc: Loc): EffectiveSecurity {
    const own = arrayAt(o, 'security');
    if (own !== undefined) return this.effectiveSecurity(own, child(opLoc, 'security'), 'operation');
    if (this.rootSecurity !== undefined)
      return this.effectiveSecurity(this.rootSecurity.value, this.rootSecurity.loc, 'root');
    return { origin: 'none', alternatives: [], anonymousAllowed: true };
  }

  /** Canonical OR-of-ANDs form of a security requirement list (N7). */
  effectiveSecurity(list: readonly CanonicalJson[], loc: Loc, origin: 'operation' | 'root'): EffectiveSecurity {
    let anonymous = list.length === 0;
    const alternatives = new Map<string, SecurityAlternative>();
    list.forEach((req, i) => {
      if (!isCanonicalObject(req)) return;
      const names = Object.keys(req);
      if (names.length === 0) {
        anonymous = true;
        return;
      }
      const alt = new Map<string, ReadonlySet<string>>();
      for (const name of names.sort(compareCodeUnits)) {
        if (!this.securitySchemes.has(name)) {
          this.ctx.report('CGD-SEM-004', `Unknown security scheme "${name}"`, child(loc, i, name));
        }
        const scopes = req[name];
        const list2 =
          scopes !== undefined && isCanonicalArray(scopes)
            ? scopes.filter((s): s is string => typeof s === 'string')
            : [];
        alt.set(name, new Set([...new Set(list2)].sort(compareCodeUnits)));
      }
      const key = stringifyCanonical(canonicalObject([...alt].map(([k, v]) => [k, [...v]])));
      alternatives.set(key, alt);
    });
    return {
      origin,
      alternatives: [...alternatives].sort(([a], [b]) => compareCodeUnits(a, b)).map(([, v]) => v),
      anonymousAllowed: anonymous,
      source: this.ctx.source(loc),
    };
  }
}

function serialization(o: CanonicalObject, location: string): ParameterSerialization {
  const rawStyle = str(o, 'style');
  const defaultStyle: SerializationStyle = location === 'query' || location === 'cookie' ? 'form' : 'simple';
  const style = rawStyle !== undefined && STYLES.has(rawStyle) ? (rawStyle as SerializationStyle) : defaultStyle;
  const explode = bool(o, 'explode') ?? style === 'form';
  return {
    style,
    explode,
    allowReserved: bool(o, 'allowReserved') === true,
    explicit: {
      style: rawStyle !== undefined,
      explode: bool(o, 'explode') !== undefined,
      allowReserved: bool(o, 'allowReserved') !== undefined,
    },
  };
}

/** Splits a path into literal, template and mixed segments (N2). */
export function pathSegments(path: string): PathSegment[] {
  let position = 0;
  return path
    .split('/')
    .slice(1)
    .map((segment): PathSegment => {
      const whole = /^\{([^{}]*)\}$/.exec(segment);
      if (whole !== null) {
        position += 1;
        return { kind: 'template', name: whole[1] as string, position };
      }
      const names = [...segment.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] as string);
      if (names.length > 0) {
        position += names.length;
        return { kind: 'mixed', raw: segment, names };
      }
      return { kind: 'literal', value: segment };
    });
}

/** Normalizes components.securitySchemes, with definition fingerprints for rename detection. */
export function normalizeSecuritySchemes(
  ctx: NormalizeContext,
  root: CanonicalObject,
  rootLoc: Loc,
): ReadonlyMap<string, SecurityScheme> {
  const raw = objectAt(objectAt(root, 'components') ?? {}, 'securitySchemes') ?? {};
  const out: [string, SecurityScheme][] = [];
  for (const key of Object.keys(raw)) {
    const s = ctx.resolveObject(child(rootLoc, 'components', 'securitySchemes', key), 'a security scheme');
    if (s === undefined) continue;
    const scheme = securityScheme(ctx, key, s);
    if (scheme !== undefined) out.push([key, scheme]);
  }
  return sortedMap(out);
}

function securityScheme(ctx: NormalizeContext, key: string, s: Resolved<CanonicalObject>): SecurityScheme | undefined {
  const o = s.value;
  const type = str(o, 'type');
  const traced = { key, source: s.source, via: s.via };
  const fp = (def: Record<string, unknown>): string => {
    const r = canonicalFrom(def);
    return shortHash(r, 16);
  };
  switch (type) {
    case 'apiKey': {
      const name = str(o, 'name') ?? '';
      const location = str(o, 'in');
      const at = location === 'query' || location === 'header' || location === 'cookie' ? location : 'header';
      return {
        ...traced,
        type: 'apiKey',
        name,
        in: at,
        fingerprint: fp({ type, name: at === 'header' ? name.toLowerCase() : name, in: at }),
      };
    }
    case 'http': {
      const scheme = (str(o, 'scheme') ?? '').toLowerCase();
      const bearerFormat = str(o, 'bearerFormat');
      return {
        ...traced,
        type: 'http',
        scheme,
        ...(bearerFormat === undefined ? {} : { bearerFormat }),
        fingerprint: fp({ type, scheme }),
      };
    }
    case 'oauth2': {
      const flowsRaw = objectAt(o, 'flows') ?? {};
      const flows: [OAuthFlowKind, OAuthFlow][] = [];
      for (const kind of Object.keys(flowsRaw)) {
        const f = objectAt(flowsRaw, kind);
        if (f === undefined) continue;
        const authorizationUrl = str(f, 'authorizationUrl');
        const tokenUrl = str(f, 'tokenUrl');
        const refreshUrl = str(f, 'refreshUrl');
        flows.push([
          kind,
          {
            ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
            ...(tokenUrl === undefined ? {} : { tokenUrl }),
            ...(refreshUrl === undefined ? {} : { refreshUrl }),
            scopes: new Set(Object.keys(objectAt(f, 'scopes') ?? {}).sort(compareCodeUnits)),
          },
        ]);
      }
      const flowMap = sortedMap(flows);
      return {
        ...traced,
        type: 'oauth2',
        flows: flowMap,
        fingerprint: fp({
          type,
          flows: Object.fromEntries(
            [...flowMap].map(([k, f]) => [k, { a: f.authorizationUrl ?? null, t: f.tokenUrl ?? null }]),
          ),
        }),
      };
    }
    case 'openIdConnect': {
      const url = str(o, 'openIdConnectUrl') ?? '';
      return { ...traced, type: 'openIdConnect', openIdConnectUrl: url, fingerprint: fp({ type, url }) };
    }
    case 'mutualTLS':
      return { ...traced, type: 'mutualTLS', fingerprint: fp({ type }) };
    default:
      ctx.report('CGD-SPEC-005', `Unknown security scheme type "${type ?? '(missing)'}"`, s.loc);
      return undefined;
  }
}

function canonicalFrom(value: Record<string, unknown>): CanonicalJson {
  return canonicalObject(
    Object.entries(value).map(([k, v]) => [
      k,
      v !== null && typeof v === 'object'
        ? canonicalFrom(v as Record<string, unknown>)
        : ((v ?? null) as CanonicalJson),
    ]),
  );
}

/** Normalizes root servers (default "/" per OAS when absent). */
export function normalizeServers(ctx: NormalizeContext, root: CanonicalObject, rootLoc: Loc): readonly Server[] {
  const raw = arrayAt(root, 'servers');
  const list = raw === undefined || raw.length === 0 ? undefined : raw;
  if (list === undefined) {
    return [
      {
        urlTemplate: '/',
        variables: new Map(),
        basePath: '/',
        source: ctx.source({ uri: rootLoc.uri, pointer: ROOT_POINTER }),
        via: [],
      },
    ];
  }
  const out: Server[] = [];
  list.forEach((entry, i) => {
    const loc = child(rootLoc, 'servers', i);
    if (!isCanonicalObject(entry)) return;
    const url = str(entry, 'url');
    if (url === undefined) {
      ctx.report('CGD-SPEC-005', 'Server needs a "url"', loc);
      return;
    }
    const varsRaw = objectAt(entry, 'variables') ?? {};
    const variables: [string, ServerVariable][] = [];
    for (const name of Object.keys(varsRaw)) {
      const v = objectAt(varsRaw, name);
      if (v === undefined) continue;
      const enumValues = arrayAt(v, 'enum')?.filter((x): x is string => typeof x === 'string');
      variables.push([
        name,
        { default: str(v, 'default') ?? '', ...(enumValues === undefined ? {} : { enum: enumValues }) },
      ]);
    }
    const variableMap = sortedMap(variables);
    const substituted = url.replace(/\{([^{}]+)\}/g, (_, name: string) => variableMap.get(name)?.default ?? '');
    out.push({
      urlTemplate: url,
      variables: variableMap,
      basePath: basePathOf(substituted),
      source: ctx.source(loc),
      via: [],
    });
  });
  return out;
}

/** Path component of a (possibly relative) server URL, without a trailing slash (except "/"). */
export function basePathOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/, 1)[0] ?? '/';
    if (!path.startsWith('/')) path = `/${path}`;
  }
  path = path.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}
