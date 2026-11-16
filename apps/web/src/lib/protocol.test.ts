import { describe, expect, it } from "vitest";
import { contentPoint, MAX_FILE_BYTES, sha256, validOffer } from "./protocol";

describe("coordenadas da tela compartilhada", () => {
  const rect = { left: 100, top: 30, width: 1000, height: 600 };
  it("ignora as barras laterais de vídeo portrait sem deslocar toques", () => {
    expect(contentPoint(120, 330, rect, 720, 1280)).toBeNull();
    expect(contentPoint(600, 330, rect, 720, 1280)).toEqual({ x: .5, y: .5 });
  });
  it("preserva coordenadas normalizadas depois de rotacionar o stream", () => {
    expect(contentPoint(600, 330, rect, 1280, 720)).toEqual({ x: .5, y: .5 });
    expect(contentPoint(600, 31, rect, 1280, 720)).toBeNull();
  });
  it("não gera comandos antes de conhecer as dimensões do vídeo", () => {
    expect(contentPoint(600, 330, rect, 0, 0)).toBeNull();
  });
});
describe("protocolo de arquivos selecionados", () => {
  const offer = { type: "file-offer", id: "ab12-1234", name: "relatorio.pdf", size: 1234, sha256: "a".repeat(64), direction: "download" };
  it("aceita arquivo com metadados íntegros dentro da cota", () => expect(validOffer(offer)).toBe(true));
  it("recusa caminhos, controle, cotas excedidas e tamanhos fracionários", () => {
    for (const name of ["../senha.txt", "a\\b.txt", "a\u0000.txt", ""]) expect(validOffer({ ...offer, name })).toBe(false);
    for (const size of [-1, .5, NaN, Infinity, MAX_FILE_BYTES + 1]) expect(validOffer({ ...offer, size })).toBe(false);
  });
  it("recusa hashes truncados ou identificadores não seguros", () => {
    expect(validOffer({ ...offer, sha256: "a".repeat(63) })).toBe(false);
    expect(validOffer({ ...offer, id: "../../arquivo" })).toBe(false);
  });
  it("calcula SHA-256 dos bytes reais", async () => {
    const buffer = new TextEncoder().encode("abc").buffer;
    expect(await sha256(buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
