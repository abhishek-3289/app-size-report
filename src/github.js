import fs from 'node:fs';

const PAGE_SIZE = 100;
const PULL_REQUEST_EVENTS = new Set(['pull_request', 'pull_request_target']);

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export function pullRequestNumber(env) {
  if (!PULL_REQUEST_EVENTS.has(env.GITHUB_EVENT_NAME) || !env.GITHUB_EVENT_PATH) return null;
  let event;
  try {
    event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    return null;
  }
  const number = event?.pull_request?.number ?? event?.number;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function headersFor(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'app-size-report',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function request(fetchImpl, url, init, what) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message ? `: ${body.message}` : '';
    } catch {
      detail = '';
    }
    throw new GitHubError(`GitHub API ${what} failed with HTTP ${response.status}${detail}`, response.status);
  }
  return response.json();
}

export async function upsertStickyComment({ fetchImpl, apiUrl, token, repository, issueNumber, marker, body }) {
  const root = `${apiUrl.replace(/\/+$/, '')}/repos/${repository}/issues`;
  const headers = headersFor(token);
  let existing = null;
  for (let page = 1; !existing; page++) {
    const comments = await request(
      fetchImpl,
      `${root}/${issueNumber}/comments?per_page=${PAGE_SIZE}&page=${page}`,
      { method: 'GET', headers },
      'list comments',
    );
    existing = comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(marker)) ?? null;
    if (comments.length < PAGE_SIZE) break;
  }
  const payload = JSON.stringify({ body });
  if (existing) {
    const updated = await request(
      fetchImpl,
      `${root}/comments/${existing.id}`,
      { method: 'PATCH', headers, body: payload },
      'update comment',
    );
    return { action: 'updated', id: updated.id, url: updated.html_url };
  }
  const created = await request(
    fetchImpl,
    `${root}/${issueNumber}/comments`,
    { method: 'POST', headers, body: payload },
    'create comment',
  );
  return { action: 'created', id: created.id, url: created.html_url };
}
