import type { RuleDefinition } from '@contractguard/core';
import { API_RULES, SRV_RULES } from './api-srv.js';
import { REQ_RULES } from './req.js';
import { RES_RULES } from './res.js';
import { AUTH_RULES, SCHEMA_RULES } from './schema-auth.js';

/** Version of the rule catalog; bumped whenever rule behaviour changes (§20.4). */
export const RULESET_VERSION = '1.0.0';

/** The v1 rule catalog (§10.6): 83 rules. */
export const RULES: readonly RuleDefinition[] = Object.freeze([
  ...API_RULES,
  ...SRV_RULES,
  ...REQ_RULES,
  ...RES_RULES,
  ...SCHEMA_RULES,
  ...AUTH_RULES,
]);

export { API_RULES, AUTH_RULES, REQ_RULES, RES_RULES, SCHEMA_RULES, SRV_RULES };
