import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, post, setCsrfToken } from "./api";
afterEach(() => { vi.unstubAllGlobals(); setCsrfToken(""); });
describe("cliente API autenticado", () => {
  it("envia cookie e token CSRF nas mutações sem salvar credenciais no navegador", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); setCsrfToken("csrf-example");
    await post("/pairing");
    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
    expect(options.headers.get("x-csrf-token")).toBe("csrf-example");
    expect(options.headers.get("authorization")).toBeNull();
  });
  it("não envia token CSRF em consultas de leitura", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); setCsrfToken("csrf-example");
    await api("/devices");
    expect(fetchMock.mock.calls[0][1].headers.get("x-csrf-token")).toBeNull();
  });
  it("preserva MFA_REQUIRED para mostrar a etapa do autenticador", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "MFA_REQUIRED", message: "Informe o código." }), { status: 401 })));
    await expect(post("/auth/login", { email: "a@b.test", password: "example" })).rejects.toMatchObject({ status: 401, code: "MFA_REQUIRED" });
  });
  it("torna falha de rede visível, sem apresentar sucesso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/devices")).rejects.toBeInstanceOf(ApiError);
    await expect(api("/devices")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});
