import { z } from 'zod';

const KB = 1024;
const SIZE = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|KiB|MiB|GiB)$/i;
const UNITS: Readonly<Record<string, number>> = { B: 1, KB, MB: KB * KB, GB: KB * KB * KB };

/** Parses `20MB`, `512 KB`, `1.5GB` (binary units; `MiB` spellings accepted) or a plain byte count. */
export function parseSize(value: number | string): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  const m = SIZE.exec(value.trim());
  if (m === null) return undefined;
  const bytes = Math.round(Number(m[1]) * (UNITS[(m[2] as string).toUpperCase().replace('I', '')] as number));
  return bytes > 0 ? bytes : undefined;
}

const size = (max: number): z.ZodType<number | string> =>
  z.union([z.number().int().positive(), z.string().regex(SIZE, 'expected a size such as 20MB')]).refine(
    (v) => {
      const n = parseSize(v);
      return n !== undefined && n <= max;
    },
    `must be a positive size of at most ${String(max / (KB * KB * KB))}GB`,
  );

const positiveInt = (max: number): z.ZodNumber => z.number().int().positive().max(max);

const CLASSIFICATION = z.enum(['breaking', 'potentially-breaking', 'undetermined', 'non-breaking', 'informational']);
const SEVERITY = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const RULE_ID = z.string().regex(/^CG-[A-Z]+-\d{3}$/, 'expected a rule id such as CG-RES-001');
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');
const FILTER = z.string().regex(/^(\*|[A-Za-z]+):\/\S*$/, 'expected "<METHOD|*>:<path-glob>", e.g. "*:/internal/**"');

/** The `.contractguard.yaml` schema, version 1 (§12.6). Unknown keys are errors. */
const ConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema URL for editor support; ignored by ContractGuard.'),
    version: z.literal(1).describe('Configuration format version. Always 1.'),
    specs: z
      .array(
        z.strictObject({
          id: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lower-case letters, digits and dashes (max 63)')
            .describe('Name of this comparison; also the report file name.'),
          candidate: z
            .string()
            .min(1)
            .describe('The new version: a path, git:<ref>:<path>, snapshot:<file> or an https URL.'),
          base: z
            .string()
            .min(1)
            .describe(
              'The version to compare against, e.g. git:origin/main:openapi.yaml or git:@base:openapi.yaml in CI.',
            ),
        }),
      )
      .min(1)
      .describe('The comparisons to run, each with a base and a candidate.'),
    compatibility: z
      .strictObject({
        perspective: z
          .enum(['provider-backward'])
          .optional()
          .describe(
            'Whose compatibility is checked. provider-backward (default): can existing consumers keep working against the new provider?',
          ),
      })
      .optional()
      .describe('Compatibility model.'),
    policy: z
      .strictObject({
        failOn: z
          .array(CLASSIFICATION)
          .refine((a) => new Set(a).size === a.length, 'duplicate classification')
          .optional()
          .describe('Classifications that fail the check. Default: [breaking].'),
        minSeverity: SEVERITY.optional().describe('Findings below this severity never fail the check. Default: low.'),
        undetermined: z
          .enum(['fail', 'review', 'ignore'])
          .optional()
          .describe(
            'Findings whose compatibility cannot be decided: fail the check, show for review (default) or hide.',
          ),
      })
      .optional(),
    analysis: z
      .strictObject({
        strictResponseValidation: z
          .boolean()
          .optional()
          .describe(
            'Assume consumers reject unknown response properties (new response properties become potentially breaking). Default: false.',
          ),
        constraintTightening: z
          .enum(['potentially-breaking', 'breaking'])
          .optional()
          .describe(
            'Classification of tighter request constraints such as a lower maximum or a stricter pattern. Default: potentially-breaking.',
          ),
        responseEnumAdditions: z
          .enum(['potentially-breaking', 'non-breaking', 'breaking'])
          .optional()
          .describe('Classification of new enum values in responses. Default: potentially-breaking.'),
        removedRequestParameters: z
          .enum(['non-breaking', 'potentially-breaking'])
          .optional()
          .describe(
            'Classification of removed optional request parameters that consumers may still send. Default: non-breaking.',
          ),
        closedResponseAdditions: z
          .enum(['potentially-breaking', 'breaking'])
          .optional()
          .describe(
            'Classification of new properties in responses declared closed (additionalProperties: false). Default: potentially-breaking.',
          ),
        honorExtensibleEnum: z
          .boolean()
          .optional()
          .describe(
            'Treat x-extensible-enum (and enums marked extensible) as open: new values are non-breaking. Default: true.',
          ),
        includeEquivalentChanges: z
          .boolean()
          .optional()
          .describe(
            'Report changes that only alter the representation, e.g. nullable: true ↔ type: [.., null]. Default: false.',
          ),
        allowInvalidSpec: z
          .boolean()
          .optional()
          .describe('Continue past specification errors; the run is marked degraded. Default: false.'),
        limits: z
          .strictObject({
            maxDocumentBytes: size(KB * KB * KB)
              .optional()
              .describe('Largest single document, e.g. 20MB (default).'),
            maxTotalBytes: size(4 * KB * KB * KB)
              .optional()
              .describe('Total size of all documents of one side. Default: 100MB.'),
            maxDocuments: positiveInt(100_000)
              .optional()
              .describe('Documents reachable through $ref per side. Default: 5000.'),
            maxDepth: positiveInt(10_000).optional().describe('Maximum nesting depth of a document. Default: 256.'),
            maxRefHops: positiveInt(10_000).optional().describe('Maximum length of a $ref chain. Default: 64.'),
            maxSchemaPairs: positiveInt(100_000_000)
              .optional()
              .describe('Schema pairs compared before the rest becomes undetermined. Default: 250000.'),
            timeoutMs: positiveInt(3_600_000)
              .optional()
              .describe('Time limit per spec in milliseconds. Default: 120000.'),
          })
          .optional(),
      })
      .optional(),
    rules: z
      .strictObject({
        disable: z.array(RULE_ID).optional().describe('Rule ids to turn off completely.'),
        overrides: z
          .record(
            RULE_ID,
            z.strictObject({
              classification: CLASSIFICATION.optional(),
              severity: SEVERITY.optional(),
              options: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(),
            }),
          )
          .optional(),
        ignore: z
          .array(
            z
              .strictObject({
                rule: RULE_ID.optional().describe('Silence this rule (optionally narrowed by operation and path).'),
                fingerprint: z
                  .string()
                  .regex(/^[0-9a-f]{32}$/, 'expected a 32-character finding fingerprint')
                  .optional()
                  .describe('Silence exactly one finding (fingerprints are stable across runs).'),
                operation: z
                  .string()
                  .regex(/^[A-Za-z]+ \/\S*$/, 'expected "METHOD /path"')
                  .optional()
                  .describe('Limit the ignore to one operation, e.g. "GET /users/{id}".'),
                path: z.string().min(1).optional().describe('Schema path the ignore applies to, e.g. $.items[].name.'),
                reason: z
                  .string()
                  .trim()
                  .min(10, 'a reason of at least 10 characters is required')
                  .describe('Why this is acceptable. Shown in reports.'),
                expires: ISO_DATE.optional().describe(
                  'YYYY-MM-DD after which the ignore stops applying (warned 30 days ahead).',
                ),
              })
              .refine(
                (e) => e.rule !== undefined || e.fingerprint !== undefined,
                'an ignore entry needs "rule" or "fingerprint"',
              ),
          )
          .optional(),
      })
      .optional(),
    filters: z
      .strictObject({
        include: z
          .array(FILTER)
          .optional()
          .describe('Only check operations matching one of these, e.g. "*:/public/**".'),
        exclude: z
          .array(FILTER)
          .optional()
          .describe('Skip operations matching one of these, e.g. "*:/internal/**" or "POST:/admin/*".'),
        excludeTags: z.array(z.string().min(1)).optional().describe('Skip operations with any of these tags.'),
        excludeExtensions: z
          .array(z.string().regex(/^x-/, 'extensions start with "x-"'))
          .optional()
          .describe('Skip operations where one of these extensions is true, e.g. x-internal.'),
      })
      .optional(),
    references: z
      .strictObject({
        root: z
          .string()
          .min(1)
          .optional()
          .describe('Local $ref targets must be inside this directory. Default: the git repository root.'),
        allowRemote: z
          .boolean()
          .optional()
          .describe(
            'Allow http(s) $refs to allowedHosts. Default: false. In CI it also needs --allow-remote-references.',
          ),
        allowedHosts: z
          .array(z.string().regex(/^[a-z0-9.-]+(:\d+)?$/i, 'exact host names only (no wildcards)'))
          .optional()
          .describe('Exact host names remote $refs may load from (no wildcards).'),
        allowedSchemes: z
          .array(z.enum(['https', 'http']))
          .optional()
          .describe('URL schemes for remote $refs. Default: [https].'),
        fetchTimeoutMs: positiveInt(600_000).optional().describe('Timeout per remote document. Default: 10000.'),
        maxRemoteBytes: size(KB * KB * KB)
          .optional()
          .describe('Largest remote document. Default: 5MB.'),
      })
      .refine((r) => r.allowRemote !== true || (r.allowedHosts?.length ?? 0) > 0, {
        message: 'allowedHosts must list at least one host when allowRemote is true',
        path: ['allowedHosts'],
      })
      .optional(),
    report: z
      .strictObject({
        formats: z
          .array(z.enum(['console', 'markdown', 'json', 'sarif']))
          .optional()
          .describe('Report formats. Default: [console]; in CI [console, json]. Files are written to outputDir.'),
        outputDir: z
          .string()
          .min(1)
          .optional()
          .describe('Directory for report files, relative to this file. Default: .contractguard/reports.'),
        groupBy: z
          .enum(['cause', 'operation'])
          .optional()
          .describe('Group findings by root cause (default) or by operation.'),
        deterministic: z
          .boolean()
          .optional()
          .describe('Omit timestamps so reports are byte-identical across runs. Default: false.'),
      })
      .optional(),
  })
  .strict();

export type ConfigFile = z.output<typeof ConfigSchema>;
export type ConfigIssue = z.core.$ZodIssue;

/** Top-level keys of the configuration file (for "did you mean" suggestions). */
export const CONFIG_KEYS: readonly string[] = Object.keys(ConfigSchema.shape);

/** Validates a parsed configuration document against the v1 schema. */
export function parseConfigFile(
  input: unknown,
):
  | { readonly success: true; readonly data: ConfigFile }
  | { readonly success: false; readonly issues: readonly ConfigIssue[] } {
  const r = ConfigSchema.safeParse(input);
  return r.success ? { success: true, data: r.data } : { success: false, issues: r.error.issues };
}

/** JSON Schema for editor completion (published as schemas/config.v1.json). */
export function configJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ConfigSchema, { io: 'input', target: 'draft-2020-12' }) as Record<string, unknown>;
  return {
    ...schema,
    $id: 'https://contractguard.dev/schemas/config.v1.json',
    title: 'ContractGuard configuration (.contractguard.yaml), version 1',
  };
}
