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
    $schema: z.string().optional(),
    version: z.literal(1),
    specs: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lower-case letters, digits and dashes (max 63)'),
          candidate: z.string().min(1),
          base: z.string().min(1),
        }),
      )
      .min(1),
    compatibility: z.strictObject({ perspective: z.enum(['provider-backward']).optional() }).optional(),
    policy: z
      .strictObject({
        failOn: z
          .array(CLASSIFICATION)
          .refine((a) => new Set(a).size === a.length, 'duplicate classification')
          .optional(),
        minSeverity: SEVERITY.optional(),
        undetermined: z.enum(['fail', 'review', 'ignore']).optional(),
      })
      .optional(),
    analysis: z
      .strictObject({
        strictResponseValidation: z.boolean().optional(),
        constraintTightening: z.enum(['potentially-breaking', 'breaking']).optional(),
        responseEnumAdditions: z.enum(['potentially-breaking', 'non-breaking', 'breaking']).optional(),
        removedRequestParameters: z.enum(['non-breaking', 'potentially-breaking']).optional(),
        closedResponseAdditions: z.enum(['potentially-breaking', 'breaking']).optional(),
        honorExtensibleEnum: z.boolean().optional(),
        includeEquivalentChanges: z.boolean().optional(),
        allowInvalidSpec: z.boolean().optional(),
        limits: z
          .strictObject({
            maxDocumentBytes: size(KB * KB * KB).optional(),
            maxTotalBytes: size(4 * KB * KB * KB).optional(),
            maxDocuments: positiveInt(100_000).optional(),
            maxDepth: positiveInt(10_000).optional(),
            maxRefHops: positiveInt(10_000).optional(),
            maxSchemaPairs: positiveInt(100_000_000).optional(),
            timeoutMs: positiveInt(3_600_000).optional(),
          })
          .optional(),
      })
      .optional(),
    rules: z
      .strictObject({
        disable: z.array(RULE_ID).optional(),
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
                rule: RULE_ID.optional(),
                fingerprint: z
                  .string()
                  .regex(/^[0-9a-f]{32}$/, 'expected a 32-character finding fingerprint')
                  .optional(),
                operation: z
                  .string()
                  .regex(/^[A-Za-z]+ \/\S*$/, 'expected "METHOD /path"')
                  .optional(),
                path: z.string().min(1).optional(),
                reason: z.string().trim().min(10, 'a reason of at least 10 characters is required'),
                expires: ISO_DATE.optional(),
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
        include: z.array(FILTER).optional(),
        exclude: z.array(FILTER).optional(),
        excludeTags: z.array(z.string().min(1)).optional(),
        excludeExtensions: z.array(z.string().regex(/^x-/, 'extensions start with "x-"')).optional(),
      })
      .optional(),
    references: z
      .strictObject({
        root: z.string().min(1).optional(),
        allowRemote: z.boolean().optional(),
        allowedHosts: z
          .array(z.string().regex(/^[a-z0-9.-]+(:\d+)?$/i, 'exact host names only (no wildcards)'))
          .optional(),
        allowedSchemes: z.array(z.enum(['https', 'http'])).optional(),
        fetchTimeoutMs: positiveInt(600_000).optional(),
        maxRemoteBytes: size(KB * KB * KB).optional(),
      })
      .refine((r) => r.allowRemote !== true || (r.allowedHosts?.length ?? 0) > 0, {
        message: 'allowedHosts must list at least one host when allowRemote is true',
        path: ['allowedHosts'],
      })
      .optional(),
    report: z
      .strictObject({
        formats: z.array(z.enum(['console', 'markdown', 'json', 'sarif'])).optional(),
        outputDir: z.string().min(1).optional(),
        groupBy: z.enum(['cause', 'operation']).optional(),
        deterministic: z.boolean().optional(),
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
