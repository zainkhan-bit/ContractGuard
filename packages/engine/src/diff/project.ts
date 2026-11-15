import type { ContractChange, Direction, OperationKey, SchemaPathSegment, UsageSite } from '@contractguard/core';
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
export function projectUsage(differ: SchemaDiffer, rootPair: string, usage: SchemaUsage): ContractChange[] {
  differ.finalize();
  const out: ContractChange[] = [];
  const onPath = new Set<string>();
  const path: SchemaPathSegment[] = []; // shared stack; copied only when a change is emitted
  const visit = (pairKey: string): void => {
    const d = differ.delta(pairKey);
    if (!d.changed || onPath.has(pairKey)) return;
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
    for (const child of d.children) {
      if (hiddenIn(child.access, usage.direction)) continue;
      path.push(child.segment);
      visit(child.pair);
      path.pop();
    }
    onPath.delete(pairKey);
  };
  visit(rootPair);
  return out;
}
