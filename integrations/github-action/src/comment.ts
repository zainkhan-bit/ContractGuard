/** First line of every ContractGuard comment; the upsert finds its own comment by it. */
export const COMMENT_MARKER = '<!-- contractguard:report v1 -->';

/** GitHub rejects comment bodies above 65,536 characters. */
export const MAX_COMMENT_CHARS = 65_536;

export type CommentOutcome = 'created' | 'updated' | 'unchanged' | 'skipped-readonly' | 'failed';

export interface GitHubApi {
  readonly apiUrl: string;
  readonly repository: string;
  readonly token: string;
  /** Injectable for tests. */
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt for 5xx, 429 and secondary rate limits (default 3). */
  readonly retries?: number;
}

interface IssueComment {
  readonly id: number;
  readonly body?: string;
  readonly user?: { readonly type?: string } | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits suggested by the response (retry-after, rate-limit reset), else exponential backoff; capped at 60 s. */
function retryDelay(res: Response, attempt: number): number {
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.min(after * 1000, 60_000);
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.min(Math.max(reset * 1000 - Date.now(), 1000), 60_000);
  }
  return 1000 * 2 ** attempt;
}

async function isRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')) return true;
  const text = await res.clone().text();
  return /secondary rate limit/i.test(text);
}

async function request(
  api: GitHubApi,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: unknown; res: Response }> {
  const doFetch = api.fetch ?? fetch;
  const sleep = api.sleep ?? defaultSleep;
  const retries = api.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(`${api.apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${api.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'contractguard-action',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.ok) return { data: res.status === 204 ? undefined : await res.json(), res };
    const retryable = res.status >= 500 || (await isRateLimited(res));
    if (!retryable || attempt >= retries) {
      const text = await res.text();
      throw new HttpError(res.status, `${method} ${path} → ${String(res.status)} ${text.slice(0, 200)}`);
    }
    await sleep(retryDelay(res, attempt));
  }
}

function nextPage(res: Response): string | undefined {
  const link = res.headers.get('link') ?? '';
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  if (m === null) return undefined;
  const url = new URL(m[1] as string);
  return `${url.pathname}${url.search}`;
}

/** Fits a Markdown body under GitHub's limit, keeping the marker and closing with a pointer to the job summary. */
export function commentBody(markdown: string, runUrl?: string): string {
  const head = `${COMMENT_MARKER}\n`;
  const full = `${head}${markdown}`;
  if (full.length <= MAX_COMMENT_CHARS) return full;
  const tail = `\n\n…truncated. The full report is in the [job summary](${runUrl ?? '#'}).\n`;
  return `${full.slice(0, MAX_COMMENT_CHARS - tail.length)}${tail}`;
}

/**
 * Creates or updates the single ContractGuard comment on a pull request (idempotent through the marker). Never
 * throws: failures become an outcome so a comment problem cannot change the job result (§13.6).
 */
export async function upsertComment(
  api: GitHubApi,
  prNumber: number,
  body: string,
  log: (line: string) => void,
): Promise<CommentOutcome> {
  const base = `/repos/${api.repository}/issues`;
  try {
    let existing: IssueComment | undefined;
    let path: string | undefined = `${base}/${String(prNumber)}/comments?per_page=100`;
    while (path !== undefined && existing === undefined) {
      const page = await request(api, 'GET', path);
      existing = (page.data as IssueComment[]).find((c) => c.body?.startsWith(COMMENT_MARKER) === true);
      path = nextPage(page.res);
    }
    if (existing !== undefined) {
      if (existing.body === body) return 'unchanged';
      await request(api, 'PATCH', `${base}/comments/${String(existing.id)}`, { body });
      return 'updated';
    }
    await request(api, 'POST', `${base}/${String(prNumber)}/comments`, { body });
    return 'created';
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      log(
        `Could not write the PR comment (HTTP ${String(error.status)}): the token needs "pull-requests: write". ` +
          'Fork pull requests always get a read-only token; the job summary still has the full report.',
      );
      return 'skipped-readonly';
    }
    log(`Could not write the PR comment: ${(error as Error).message}`);
    return 'failed';
  }
}
