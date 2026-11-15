import { describe, expect, it } from 'vitest';
import { detectVersion } from '../../src/version/detect.js';
import { codes, parseOk } from '../helpers.js';

describe('detectVersion', () => {
  it.each([
    ['openapi: "3.0.0"', 'oas30', '3.0.0'],
    ['openapi: 3.0.4', 'oas30', '3.0.4'],
    ['openapi: "3.1.0"', 'oas31', '3.1.0'],
    ['openapi: 3.1.2', 'oas31', '3.1.2'],
    ['openapi: " 3.1.1 "', 'oas31', '3.1.1'],
  ])('%s → %s', (text, dialect, version) => {
    const r = detectVersion(parseOk(`${text}\n`));
    expect(r.value).toEqual({ dialect, version });
    expect(r.diagnostics).toEqual([]);
  });

  it('accepts a numeric version with a warning', () => {
    const r = detectVersion(parseOk('openapi: 3.1\n'), 'candidate');
    expect(r.value).toEqual({ dialect: 'oas31', version: '3.1' });
    expect(codes(r.diagnostics)).toEqual(['CGD-SPEC-004']);
    expect(r.diagnostics[0]?.side).toBe('candidate');
    expect(r.diagnostics[0]?.location?.range?.start.line).toBe(1);
  });

  it.each([
    ['openapi: "3.2.0"', 'CGD-SPEC-002', 'planned'],
    ['openapi: "4.0.0"', 'CGD-SPEC-002', 'supported: 3.0.x and 3.1.x'],
    ['swagger: "2.0"', 'CGD-SPEC-003', 'Swagger 2.0'],
    ['info: {}', 'CGD-SPEC-001', 'Missing'],
    ['openapi: true', 'CGD-SPEC-001', 'Missing'],
    ['- 1', 'CGD-SPEC-001', 'root must be an object'],
  ])('%s → %s', (text, code, message) => {
    const r = detectVersion(parseOk(`${text}\n`));
    expect(r.value).toBeUndefined();
    expect(codes(r.diagnostics)).toContain(code);
    expect(r.diagnostics.map((d) => d.message).join(' ')).toContain(message);
  });

  it('keeps the numeric warning when the numeric version is unsupported', () => {
    const r = detectVersion(parseOk('openapi: 3.2\n'));
    expect(codes(r.diagnostics)).toEqual(['CGD-SPEC-004', 'CGD-SPEC-002']);
  });
});
