import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { GitHubError, pullRequestNumber, upsertStickyComment } from '../src/github.js';
import { tempDir } from './helpers/zip-writer.js';
import { recordingFetch } from './helpers/fetch-stub.js';

const dir = tempDir();
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const MARKER = '<!-- app-size-report:app.apk -->';
const BASE = 'https://api.github.com/repos/octo/app/issues';

const options = (fetchImpl) => ({
  fetchImpl,
  apiUrl: 'https://api.github.com/',
  token: 'test-token',
  repository: 'octo/app',
  issueNumber: 42,
  marker: MARKER,
  body: `${MARKER}\nreport`,
});

describe('upsertStickyComment', () => {
  it('creates a comment when none carries the marker', async () => {
    const stub = recordingFetch([
      { status: 200, body: [{ id: 1, body: 'LGTM' }, { id: 2, body: '<!-- app-size-report:app.apk.other -->' }] },
      { status: 201, body: { id: 99, html_url: 'https://github.com/octo/app/pull/42#issuecomment-99' } },
    ]);
    const result = await upsertStickyComment(options(stub.fetch));
    assert.deepEqual(result, { action: 'created', id: 99, url: 'https://github.com/octo/app/pull/42#issuecomment-99' });
    assert.deepEqual(stub.calls.map((call) => [call.method, call.url]), [
      ['GET', `${BASE}/42/comments?per_page=100&page=1`],
      ['POST', `${BASE}/42/comments`],
    ]);
    assert.deepEqual(stub.calls[1].body, { body: `${MARKER}\nreport` });
    assert.equal(stub.calls[1].headers.Authorization, 'Bearer test-token');
    assert.equal(stub.calls[1].headers.Accept, 'application/vnd.github+json');
    assert.equal(stub.calls[1].headers['X-GitHub-Api-Version'], '2022-11-28');
  });

  it('updates the comment that carries the marker', async () => {
    const stub = recordingFetch([
      { status: 200, body: [{ id: 7, body: `${MARKER}\nold report` }] },
      { status: 200, body: { id: 7, html_url: 'https://github.com/octo/app/pull/42#issuecomment-7' } },
    ]);
    const result = await upsertStickyComment(options(stub.fetch));
    assert.equal(result.action, 'updated');
    assert.deepEqual(stub.calls.map((call) => [call.method, call.url]), [
      ['GET', `${BASE}/42/comments?per_page=100&page=1`],
      ['PATCH', `${BASE}/comments/7`],
    ]);
    assert.deepEqual(stub.calls[1].body, { body: `${MARKER}\nreport` });
  });

  it('pages through comments until it finds the marker', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: `comment ${index}` }));
    const stub = recordingFetch([
      { status: 200, body: fullPage },
      { status: 200, body: [{ id: 500, body: `intro\n${MARKER}` }] },
      { status: 200, body: { id: 500, html_url: 'url' } },
    ]);
    const result = await upsertStickyComment(options(stub.fetch));
    assert.equal(result.action, 'updated');
    assert.deepEqual(stub.calls.map((call) => [call.method, call.url]), [
      ['GET', `${BASE}/42/comments?per_page=100&page=1`],
      ['GET', `${BASE}/42/comments?per_page=100&page=2`],
      ['PATCH', `${BASE}/comments/500`],
    ]);
  });

  it('stops paging after the first marker match', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: index === 3 ? MARKER : 'x' }));
    const stub = recordingFetch([{ status: 200, body: page }, { status: 200, body: { id: 4, html_url: 'url' } }]);
    await upsertStickyComment(options(stub.fetch));
    assert.deepEqual(stub.calls.map((call) => call.method), ['GET', 'PATCH']);
  });

  it('raises a GitHubError with the API message on failure', async () => {
    const stub = recordingFetch([
      { status: 200, body: [] },
      { status: 403, body: { message: 'Resource not accessible by integration' } },
    ]);
    await assert.rejects(upsertStickyComment(options(stub.fetch)), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.status, 403);
      assert.equal(error.message, 'GitHub API create comment failed with HTTP 403: Resource not accessible by integration');
      return true;
    });
  });
});

describe('pullRequestNumber', () => {
  const eventFile = (payload) => {
    const file = path.join(dir, `event-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    return file;
  };

  it('reads the number from a pull_request event', () => {
    const file = eventFile({ number: 42, pull_request: { number: 42 } });
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: file }), 42);
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: file }), 42);
  });

  it('returns null for other events or unreadable payloads', () => {
    const file = eventFile({ pull_request: { number: 42 } });
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: file }), null);
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'pull_request' }), null);
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: path.join(dir, 'nope.json') }), null);
    assert.equal(pullRequestNumber({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile({}) }), null);
  });
});
