import {
  ROOT_POINTER,
  appendPointer,
  diagnostic,
  isCanonicalObject,
  isJsonNumber,
  stageFail,
  stageOk,
  type CanonicalJson,
  type Diagnostic,
  type OasDialect,
  type SourceRef,
  type StageResult,
} from '@contractguard/core';
import type { ParsedDocument } from '../parse/parser.js';

export interface DetectedVersion {
  readonly dialect: OasDialect;
  /** Version string as written (normalized to text when written as a number). */
  readonly version: string;
}

/** Detects the OpenAPI version from the root `openapi` field (§8.4). */
export function detectVersion(doc: ParsedDocument, side?: 'base' | 'candidate'): StageResult<DetectedVersion> {
  const sideOpt = side === undefined ? {} : { side };
  const root = doc.value;
  const loc = (field?: string): SourceRef => {
    const pointer = field === undefined ? ROOT_POINTER : appendPointer(ROOT_POINTER, field);
    const range = doc.index.rangeOf(pointer)?.value;
    return range === undefined ? { uri: doc.uri, pointer } : { uri: doc.uri, pointer, range };
  };
  if (!isCanonicalObject(root)) {
    return stageFail([
      diagnostic('CGD-SPEC-001', 'Document root must be an object with an "openapi" field', {
        ...sideOpt,
        location: loc(),
      }),
    ]);
  }
  const swagger: CanonicalJson | undefined = root['swagger'];
  if (swagger !== undefined && root['openapi'] === undefined) {
    return stageFail([
      diagnostic('CGD-SPEC-003', 'Swagger 2.0 is not supported; convert the document to OpenAPI 3.x', {
        ...sideOpt,
        location: loc('swagger'),
      }),
    ]);
  }
  const field: CanonicalJson | undefined = root['openapi'];
  const warnings: Diagnostic[] = [];
  let text: string;
  if (typeof field === 'string') {
    text = field.trim();
  } else if (isJsonNumber(field)) {
    text = field.text;
    warnings.push(
      diagnostic('CGD-SPEC-004', `"openapi" is written as a number (${text}); it should be a string`, {
        ...sideOpt,
        location: loc('openapi'),
        hint: `Write openapi: "${text}" (quoted).`,
      }),
    );
  } else {
    return stageFail([
      diagnostic('CGD-SPEC-001', 'Missing or invalid "openapi" version field', {
        ...sideOpt,
        location: loc('openapi'),
      }),
    ]);
  }

  if (/^3\.0(\.\d+)?$/.test(text)) return stageOk({ dialect: 'oas30', version: text }, warnings);
  if (/^3\.1(\.\d+)?$/.test(text)) return stageOk({ dialect: 'oas31', version: text }, warnings);
  if (/^3\.2(\.\d+)?$/.test(text)) {
    return stageFail([
      ...warnings,
      diagnostic('CGD-SPEC-002', `OpenAPI ${text} is not supported yet (support for 3.2 is planned)`, {
        ...sideOpt,
        location: loc('openapi'),
      }),
    ]);
  }
  return stageFail([
    ...warnings,
    diagnostic('CGD-SPEC-002', `Unsupported OpenAPI version "${text}"; supported: 3.0.x and 3.1.x`, {
      ...sideOpt,
      location: loc('openapi'),
    }),
  ]);
}
