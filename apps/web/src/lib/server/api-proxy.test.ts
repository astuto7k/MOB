import { afterEach, expect, it, vi } from 'vitest';
import { proxyApi } from './api-proxy';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('fails closed when the API origin is missing or points back to the panel', async () => {
  vi.stubEnv('API_INTERNAL_URL', '');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await proxyApi(new Request('https://panel.example/api/v1/devices'))).status).toBe(503);
  vi.stubEnv('API_INTERNAL_URL', 'https://panel.example');
  expect((await proxyApi(new Request('https://panel.example/api/v1/devices'))).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it('preserves authentication and CSRF while refusing to forward credentials through redirects', async () => {
  vi.stubEnv('API_INTERNAL_URL', 'https://api.example');
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://other.example' } }));
  vi.stubGlobal('fetch', fetcher);
  const result = await proxyApi(new Request('https://panel.example/api/v1/pairing', {
    method: 'POST', headers: { cookie: 'session=test', origin: 'https://panel.example', 'x-csrf-token': 'csrf' }, body: '{}',
  }));
  expect(result.status).toBe(502);
  expect(fetcher.mock.calls[0][0].toString()).toBe('https://api.example/api/v1/pairing');
  expect(fetcher.mock.calls[0][1].headers.get('cookie')).toBe('session=test');
  expect(fetcher.mock.calls[0][1].headers.get('x-csrf-token')).toBe('csrf');
  expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
});
it('passes secure cookies from the API and rejects oversized bodies before forwarding', async () => {
  vi.stubEnv('API_INTERNAL_URL', 'https://api.example');
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'set-cookie': '__Host-arh_admin=test; Secure; HttpOnly; Path=/' } }));
  vi.stubGlobal('fetch', fetcher);
  const result = await proxyApi(new Request('https://panel.example/api/v1/auth/me'));
  expect(result.headers.get('set-cookie')).toContain('HttpOnly');
  expect(result.headers.get('cache-control')).toBe('no-store');
  const large = await proxyApi(new Request('https://panel.example/api/v1/pairing', { method: 'POST', body: 'x'.repeat(192 * 1024 + 1) }));
  expect(large.status).toBe(413);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
