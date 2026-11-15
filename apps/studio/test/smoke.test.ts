import { describe, expect, it } from 'vitest';
import { PROBE, SMOKE_FAIL, SMOKE_OK, attachSmoke, smokeEnabled } from '../src/entrypoints/smoke';

describe('teste de fumaça do app', () => {
  it('só liga com GITNEXUS_SMOKE=1', () => {
    expect(smokeEnabled({})).toBe(false);
    expect(smokeEnabled({ GITNEXUS_SMOKE: '0' })).toBe(false);
    expect(smokeEnabled({ GITNEXUS_SMOKE: 'true' })).toBe(false);
    expect(smokeEnabled({ GITNEXUS_SMOKE: '1' })).toBe(true);
  });

  it('a sonda confere a interface e a ponte com o worker', () => {
    expect(PROBE).toContain(".core");
    expect(PROBE).toContain('getKnownRepositories');
  });

  // janela falsa: registra os ouvintes e deixa o teste disparar os eventos
  const fakeWin = (probeResult: () => Promise<string>) => {
    const handlers: Record<string, (...a: any[]) => void> = {};
    const win = { webContents: { on: (ev: string, fn: (...a: any[]) => void) => (handlers[ev] = fn), executeJavaScript: probeResult } };
    return { win: win as never, handlers };
  };

  it('sai com 0 e imprime SMOKE_OK quando a interface responde', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => void logs.push(String(m));
    try {
      const codes: number[] = [];
      const { win, handlers } = fakeWin(async () => 'ok');
      attachSmoke(win, (c) => codes.push(c), 5_000);
      handlers['did-finish-load']!();
      await new Promise((r) => setTimeout(r, 30));
      expect(codes).toEqual([0]);
      expect(logs).toContain(SMOKE_OK);
    } finally {
      console.log = orig;
    }
  });

  it('sai com 1 se o renderer cair, a página não carregar ou a sonda acusar erro definitivo; só o primeiro resultado vale', async () => {
    const orig = console.log;
    const logs: string[] = [];
    console.log = (m: string) => void logs.push(String(m));
    try {
      const crash = fakeWin(async () => 'ok');
      const codes: number[] = [];
      attachSmoke(crash.win, (c) => codes.push(c), 5_000);
      crash.handlers['render-process-gone']!({}, { reason: 'crashed' });
      crash.handlers['render-process-gone']!({}, { reason: 'killed' });
      expect(codes).toEqual([1]);

      const fail = fakeWin(async () => 'window.gitNexus ausente (preload não carregou)');
      const c2: number[] = [];
      attachSmoke(fail.win, (c) => c2.push(c), 5_000);
      fail.handlers['did-finish-load']!();
      await new Promise((r) => setTimeout(r, 30));
      expect(c2).toEqual([1]);
      expect(logs.some((l) => l.startsWith(SMOKE_FAIL) && l.includes('preload'))).toBe(true);
    } finally {
      console.log = orig;
    }
  });

  it('com a interface ainda montando, repete a sonda até responder', async () => {
    const orig = console.log;
    console.log = () => undefined;
    try {
      let n = 0;
      const { win, handlers } = fakeWin(async () => (++n < 3 ? 'interface ainda não montou' : 'ok'));
      const codes: number[] = [];
      attachSmoke(win, (c) => codes.push(c), 5_000);
      handlers['did-finish-load']!();
      await new Promise((r) => setTimeout(r, 900));
      expect(n).toBe(3);
      expect(codes).toEqual([0]);
    } finally {
      console.log = orig;
    }
  });

  it('tempo esgotado sai com 2', async () => {
    const orig = console.log;
    console.log = () => undefined;
    try {
      const codes: number[] = [];
      attachSmoke(fakeWin(async () => 'interface ainda não montou').win, (c) => codes.push(c), 50);
      await new Promise((r) => setTimeout(r, 120));
      expect(codes).toEqual([2]);
    } finally {
      console.log = orig;
    }
  });
});
