import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Aviso do `pnpm audit` aceito de propósito (auditConfig.ignoreGhsas em pnpm-workspace.yaml): cada um precisa ter, logo acima, o motivo, a condição de saída
// e a issue de acompanhamento. Sem isso, um "ignorar" vira esquecimento e a auditoria perde o sentido. Todo aviso NOVO alto ou crítico continua reprovando.
const text = readFileSync(join(__dirname, '..', '..', 'pnpm-workspace.yaml'), 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');
const start = lines.findIndex((l) => /^auditConfig:\s*$/.test(l));
const ignored = start < 0 ? [] : lines.slice(start).filter((l) => /^\s+-\s+GHSA-/.test(l)).map((l) => l.replace(/^\s+-\s+/, '').trim());
const above = start < 0 ? '' : lines.slice(0, start).join('\n');

describe('auditConfig.ignoreGhsas (pnpm-workspace.yaml)', () => {
  it('cada aviso ignorado é um GHSA válido, sem repetir', () => {
    for (const g of ignored) expect(g, g).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
    expect(new Set(ignored).size).toBe(ignored.length);
  });

  it('cada aviso ignorado tem acima o motivo (sem correção, só dev), a condição de saída e a issue de acompanhamento', () => {
    for (const g of ignored) {
      const at = above.lastIndexOf(g);
      expect(at, `${g}: o comentário com o motivo deve citar o GHSA`).toBeGreaterThanOrEqual(0);
      const block = above.slice(at);
      expect(block, `${g}: faltou "RISCO ACEITO"`).toContain('RISCO ACEITO');
      expect(block, `${g}: faltou a condição de saída`).toContain('Condição de saída');
      expect(block, `${g}: faltou a issue de acompanhamento (#N)`).toMatch(/issue #\d+/);
    }
  });
});
