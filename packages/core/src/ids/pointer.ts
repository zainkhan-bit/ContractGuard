/**
 * JSON Pointer (RFC 6901) in URI-fragment notation, e.g. "#/paths/~1users/get".
 * Stored *unencoded* (no percent-encoding) for readability; use the explicit
 * conversion functions when reading from or writing to URIs.
 */
export type JsonPointer = string & { readonly __brand: 'JsonPointer' };

export const ROOT_POINTER: JsonPointer = '#' as JsonPointer;

/** Escapes one reference token per RFC 6901 ("~" → "~0", "/" → "~1"). */
export function escapeToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Unescapes one reference token. Returns undefined for invalid escape sequences ("~2", trailing "~"). */
export function unescapeToken(token: string): string | undefined {
  if (/~(?![01])/.test(token)) return undefined;
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Builds a pointer from raw (unescaped) segments. Numbers are array indexes. */
export function pointerFromSegments(segments: readonly (string | number)[]): JsonPointer {
  if (segments.length === 0) return ROOT_POINTER;
  return `#/${segments.map((s) => escapeToken(String(s))).join('/')}` as JsonPointer;
}

/** Decodes a pointer into raw (unescaped) segments. */
export function pointerSegments(pointer: JsonPointer): string[] {
  if (pointer === ROOT_POINTER) return [];
  // A valid JsonPointer only contains valid escapes, so unescapeToken cannot fail here.
  return pointer
    .slice(2)
    .split('/')
    .map((t) => unescapeToken(t) ?? t);
}

/**
 * Parses a pointer string. Accepts "#", "#/a/b", "" and "/a/b" (plain RFC 6901 form).
 * Returns undefined when the string is not a valid pointer.
 */
export function parsePointer(text: string): JsonPointer | undefined {
  const body = text.startsWith('#') ? text.slice(1) : text;
  if (body === '') return ROOT_POINTER;
  if (!body.startsWith('/')) return undefined;
  const tokens = body.slice(1).split('/');
  for (const token of tokens) {
    if (unescapeToken(token) === undefined) return undefined;
  }
  return `#${body}` as JsonPointer;
}

/** Appends raw segments to a pointer. */
export function appendPointer(pointer: JsonPointer, ...segments: readonly (string | number)[]): JsonPointer {
  if (segments.length === 0) return pointer;
  const suffix = segments.map((s) => escapeToken(String(s))).join('/');
  return (pointer === ROOT_POINTER ? `#/${suffix}` : `${pointer}/${suffix}`) as JsonPointer;
}

/** Returns the parent pointer, or undefined for the root. */
export function parentPointer(pointer: JsonPointer): JsonPointer | undefined {
  if (pointer === ROOT_POINTER) return undefined;
  const index = pointer.lastIndexOf('/');
  return (index <= 1 ? ROOT_POINTER : pointer.slice(0, index)) as JsonPointer;
}

/** True when `ancestor` equals `pointer` or is one of its ancestors. */
export function isAncestorOrSelf(ancestor: JsonPointer, pointer: JsonPointer): boolean {
  if (ancestor === ROOT_POINTER || ancestor === pointer) return true;
  return pointer.startsWith(`${ancestor}/`);
}

// RFC 3986 fragment = *( pchar / "/" / "?" ); pchar = unreserved / pct-encoded / sub-delims / ":" / "@"
const FRAGMENT_SAFE = /[A-Za-z0-9\-._~!$&'()*+,;=:@/?]/;

/** Converts a URI fragment (with or without leading "#") into a pointer, percent-decoding first. */
export function pointerFromUriFragment(fragment: string): JsonPointer | undefined {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  return parsePointer(decoded);
}

/** Converts a pointer into a percent-encoded URI fragment (including the leading "#"). */
export function pointerToUriFragment(pointer: JsonPointer): string {
  let out = '#';
  for (const ch of pointer.slice(1)) {
    if (FRAGMENT_SAFE.test(ch)) {
      out += ch;
    } else {
      for (const byte of new TextEncoder().encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}
