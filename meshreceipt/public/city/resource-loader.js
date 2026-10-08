export async function loadCityResource(url, { signal, fetcher = fetch, timeoutMs = 35_000, onRetry = () => {} } = {}) {
  signal?.throwIfAborted();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, {
        cache: attempt ? 'reload' : 'default',
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) {
        const error = new Error(`底图文件读取失败 (${response.status})：${url}`);
        error.permanent = response.status !== 408 && response.status !== 429 && response.status < 500;
        throw error;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) {
        const error = new Error(`底图文件超过支持范围：${url}`); error.permanent = true; throw error;
      }
      return bytes;
    } catch (error) {
      if (signal?.aborted || error.permanent) throw error;
      if (attempt === 2) throw new Error(`底图文件在自动重试后仍未加载：${url}。请检查网络连接并重新读取。`, { cause: error });
      onRetry({ url, attempt: attempt + 1 });
    }
  }
}
