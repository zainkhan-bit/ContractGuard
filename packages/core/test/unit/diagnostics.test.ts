import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_CODES, isDiagnosticCode } from '../../src/diagnostics/codes.js';
import {
  compareDiagnostics,
  diagnostic,
  errorsIn,
  hasErrors,
  sortDiagnostics,
  stageFail,
  stageOk,
} from '../../src/diagnostics/diagnostic.js';
import { documentUri } from '../../src/model/identity.js';
import { parsePointer, type JsonPointer } from '../../src/ids/pointer.js';

const loc = (pointer: string, offset?: number) => ({
  uri: documentUri('file:///a.yaml'),
  pointer: parsePointer(pointer) as JsonPointer,
  ...(offset === undefined
    ? {}
    : {
        range: {
          start: { line: 1, column: offset + 1, offset },
          end: { line: 1, column: offset + 2, offset: offset + 1 },
        },
      }),
});

describe('diagnostic codes', () => {
  it('follow the CGD-<AREA>-<NNN> format and have titles', () => {
    for (const [code, info] of Object.entries(DIAGNOSTIC_CODES)) {
      expect(code).toMatch(/^CGD-[A-Z]+-\d{3}$/);
      expect(info.title.length).toBeGreaterThan(3);
    }
  });

  it('use severities consistent with the numbering convention', () => {
    for (const [code, info] of Object.entries(DIAGNOSTIC_CODES)) {
      const number = Number(code.slice(-3));
      if (number >= 100) expect(info.severity).not.toBe('error');
      else expect(info.severity).not.toBe('info');
    }
  });

  it('recognizes registered codes', () => {
    expect(isDiagnosticCode('CGD-REF-001')).toBe(true);
    expect(isDiagnosticCode('CGD-REF-999')).toBe(false);
    expect(isDiagnosticCode('toString')).toBe(false);
  });
});

describe('diagnostic()', () => {
  it('takes category and severity from the registry', () => {
    const d = diagnostic('CGD-REF-001', 'Unresolved #/x', { side: 'candidate', hint: 'check the path' });
    expect(d).toEqual({
      code: 'CGD-REF-001',
      category: 'reference',
      severity: 'error',
      side: 'candidate',
      message: 'Unresolved #/x',
      hint: 'check the path',
    });
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('omits absent optional fields and allows severity overrides', () => {
    const d = diagnostic('CGD-SPEC-101', 'ignored', { severity: 'error', location: loc('#/a') });
    expect(d.severity).toBe('error');
    expect('side' in d).toBe(false);
    expect('hint' in d).toBe(false);
    expect(d.location?.pointer).toBe('#/a');
  });
});

describe('stage helpers', () => {
  const err = diagnostic('CGD-PARSE-001', 'bad');
  const warn = diagnostic('CGD-SPEC-004', 'number');

  it('builds results', () => {
    expect(stageOk(1)).toEqual({ value: 1, diagnostics: [] });
    expect(stageOk(1, [warn]).diagnostics).toEqual([warn]);
    expect(stageFail([err])).toEqual({ diagnostics: [err] });
  });

  it('detects errors by category', () => {
    expect(hasErrors([warn])).toBe(false);
    expect(hasErrors([warn, err])).toBe(true);
    expect(errorsIn([warn, err], ['parse'])).toEqual([err]);
    expect(errorsIn([warn, err], ['reference'])).toEqual([]);
  });
});

describe('deterministic ordering', () => {
  it('sorts by severity, side, document, position, pointer, code, message', () => {
    const a = diagnostic('CGD-SPEC-004', 'w', { side: 'base' });
    const b = diagnostic('CGD-REF-001', 'e2', { side: 'candidate', location: loc('#/b', 10) });
    const c = diagnostic('CGD-REF-001', 'e1', { side: 'candidate', location: loc('#/a', 5) });
    const d = diagnostic('CGD-PARSE-001', 'e0', { side: 'base' });
    const e = diagnostic('CGD-UNSUP-101', 'i');
    const f = diagnostic('CGD-REF-002', 'e3', { side: 'candidate', location: loc('#/a', 5) });
    const g = diagnostic('CGD-REF-002', 'e4', { side: 'candidate', location: loc('#/a', 5) });
    const h = diagnostic('CGD-REF-002', 'e5', { side: 'candidate', location: loc('#/c') });
    const sorted = sortDiagnostics([e, b, a, g, c, h, f, d]);
    expect(sorted.map((x) => x.message)).toEqual(['e0', 'e5', 'e1', 'e3', 'e4', 'e2', 'w', 'i']);
    expect(compareDiagnostics(a, a)).toBe(0);
  });
});
