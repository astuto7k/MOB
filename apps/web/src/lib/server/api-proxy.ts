const MAX_BODY = 192 * 1024;
const failure = (code: string, message: string, status: number) =>
  Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Only the configured API origin receives credentials; redirects are never followed. */
export async function proxyApi(request: Request): Promise<Response> {
  let target: URL;
  try {
    const configured = process.env.API_INTERNAL_URL;
    if (!configured) throw new Error('API_INTERNAL_URL missing');
    target = new URL(configured);
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(target.hostname);
    if ((target.protocol !== 'https:' && !(local && target.protocol === 'http:')) ||
        target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Invalid origin');
    const incoming = new URL(request.url);
    if (target.origin === incoming.origin || !incoming.pathname.startsWith('/api/v1/')) throw new Error('Proxy loop or invalid path');
    target.pathname = incoming.pathname;
    target.search = incoming.search;
  } catch {
    return failure('DEPLOYMENT_NOT_CONFIGURED', 'Configure API_INTERNAL_URL na Vercel com a origem HTTPS do projeto API.', 503);
  }
  const headers = new Headers();
  for (const key of ['content-type', 'authorization', 'cookie', 'origin', 'x-csrf-token', 'user-agent']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  let body: Uint8Array | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (Number(request.headers.get('content-length')) > MAX_BODY) {
      await reader?.cancel();
      return failure('PAYLOAD_TOO_LARGE', 'Solicitação excede o limite permitido.', 413);
    }
    if (reader) while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        return failure('PAYLOAD_TOO_LARGE', 'Solicitação excede o limite permitido.', 413);
      }
      chunks.push(part.value);
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  try {
    const upstream = await fetch(target, {
      method: request.method, headers, body: body as BodyInit | undefined,
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return failure('API_REDIRECT_REJECTED', 'A API redirecionou a solicitação. Confira o domínio e a proteção do deploy.', 502);
    }
    const output = new Headers({ 'Cache-Control': 'no-store' });
    for (const key of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(key);
      if (value) output.set(key, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) output.append('set-cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    return failure('API_UNAVAILABLE', 'A API está indisponível. Confira o deploy e o banco de dados.', 502);
  }
}
