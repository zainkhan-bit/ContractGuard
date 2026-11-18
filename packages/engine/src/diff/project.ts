import type {
  ContractChange,
  Direction,
  OperationKey,
  SchemaPathSegment,
  UsageSite,
} from '@zainkhan-bit/contractguard-core';
import type { PropertyAccess, SchemaDiffer } from './schema-differ.js';

export interface SchemaUsage {
  readonly operationKey: OperationKey;
  readonly site: UsageSite;
  readonly direction: Direction;
}

/** A property is invisible in a direction when it is readOnly (request) / writeOnly (response) on every side it exists. */
export function hiddenIn(access: PropertyAccess | undefined, direction: Direction): boolean {
  if (access === undefined) return false;
  const flag = direction === 'request' ? 'readOnly' : 'writeOnly';
  const sides = [access.base, access.candidate].filter((a) => a !== undefined);
  return sides.length > 0 && sides.every((a) => a[flag]);
}

/**
 * Projects pair deltas into ContractChanges for one usage site (§9.7): skips unchanged subtrees,
 * hides direction-invisible properties, and reports each change at its shallowest path.
 */
export interface ProjectionBudget {
  /** Schema pairs that may still be visited; shared by all usages of one comparison. */
  remaining: number;
}

/**
 * Projects pair deltas into ContractChanges for one usage site (§9.7). A shared budget bounds the work on
 * pathological graphs (long reference chains reached from many operations): when it runs out, the usage gets one
 * `schema.budgetExceeded` change (undetermined) instead of an unbounded walk (NFR-04).
 */
export function projectUsage(
  differ: SchemaDiffer,
  rootPair: string,
  usage: SchemaUsage,
  budget: ProjectionBudget = { remaining: Number.POSITIVE_INFINITY },
): ContractChange[] {
  differ.finalize();
  const out: ContractChange[] = [];
  const onPath = new Set<string>();
  const path: SchemaPathSegment[] = []; // shared stack; copied only when a change is emitted
  // Iterative depth-first walk (explicit stack): reference chains can be thousands of schemas deep.
  const stack: { key: string; d: ReturnType<SchemaDiffer['delta']>; next: number }[] = [];
  const state = { exhausted: false };
  const enter = (pairKey: string): boolean => {
    const d = differ.delta(pairKey);
    if (!d.changed || onPath.has(pairKey)) return false;
    if (--budget.remaining < 0) {
      state.exhausted = true;
      return false;
    }
    onPath.add(pairKey);
    let snapshot: readonly SchemaPathSegment[] | undefined;
    for (const ch of d.local) {
      if (hiddenIn(ch.access, usage.direction)) continue;
      const { detail, access: _access, ...rest } = ch;
      const where = ch.candidate.location ?? ch.base.location;
      snapshot ??= [...path];
      out.push({
        ...rest,
        subject: {
          operationKey: usage.operationKey,
          site: usage.site,
          direction: usage.direction,
          schemaPath: snapshot,
        },
        causeKey: `${ch.kind}|${where === undefined ? '' : `${where.uri}${where.pointer}`}|${detail}`,
      });
    }
    stack.push({ key: pairKey, d, next: 0 });
    return true;
  };
  enter(rootPair);
  while (stack.length > 0 && !state.exhausted) {
    const top = stack[stack.length - 1] as (typeof stack)[number];
    const child = top.d.children[top.next++];
    if (child === undefined) {
      onPath.delete(top.key);
      stack.pop();
      if (stack.length > 0) path.pop(); // the segment that led to this pair
      continue;
    }
    if (hiddenIn(child.access, usage.direction)) continue;
    path.push(child.segment);
    if (!enter(child.pair)) path.pop();
  }
  if (state.exhausted) {
    const { detail, access: _access, ...rest } = differ.budgetChange(rootPair, 'projection');
    const where = rest.candidate.location ?? rest.base.location;
    return [
      {
        ...rest,
        subject: { operationKey: usage.operationKey, site: usage.site, direction: usage.direction, schemaPath: [] },
        causeKey: `${rest.kind}|${where === undefined ? '' : `${where.uri}${where.pointer}`}|${detail}`,
      },
    ];
  }
  return out;
}
