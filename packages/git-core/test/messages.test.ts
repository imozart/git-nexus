import { afterEach, describe, expect, it } from 'vitest';
import { getMessageLocale, setMessageLocale, tm } from '../src/messages';
import { scanLine } from '../src/secrets';

afterEach(() => setMessageLocale('pt-BR'));

describe('mensagens do núcleo por idioma', () => {
  it('o padrão é o português e qualquer valor desconhecido volta para ele', () => {
    expect(getMessageLocale()).toBe('pt-BR');
    expect(tm('olá', 'hello')).toBe('olá');
    setMessageLocale('en');
    expect(tm('olá', 'hello')).toBe('hello');
    setMessageLocale('fr');
    expect(getMessageLocale()).toBe('pt-BR');
  });

  it('o scanner de segredos nomeia a regra no idioma atual', () => {
    const line = 'token = "ghp_' + 'a'.repeat(36) + '"';
    expect(scanLine(line)?.rule).toBe('Token do GitHub');
    setMessageLocale('en');
    expect(scanLine(line)?.rule).toBe('GitHub token');
  });
});
