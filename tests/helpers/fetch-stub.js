export function recordingFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${init.method ?? 'GET'} ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, calls, pending: () => queue.length };
}
