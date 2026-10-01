export function saveIdentifier() {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function createRequestClient({ fetchImpl = fetch, timeout = 10000, onConnection = () => {} } = {}) {
  return async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetchImpl(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Pocket-Request': '1', 'X-Pocket-Format': '2' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json(); onConnection(true);
      if (!response.ok) {
        const error = new Error(data.error || 'Something went wrong.'); error.status = response.status;
        error.uncertain = response.status >= 500 && body !== undefined; throw error;
      }
      return data;
    } catch (cause) {
      if (cause.status) throw cause;
      onConnection(false);
      const error = new Error(body === undefined ? 'Cannot reach your PC. Check that Pocket is running and your Tailnet is connected.' : 'The save is not confirmed. Your draft is kept. Use Check / retry save to check its result safely.');
      error.uncertain = body !== undefined; throw error;
    } finally { clearTimeout(timer); }
  };
}
