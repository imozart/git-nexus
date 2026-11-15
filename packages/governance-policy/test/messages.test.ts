import { afterEach, describe, expect, it } from 'vitest';
import { setMessageLocale } from '@git-nexus/git-core/pure';
import { parseRepoConfig, validateCommitMessage } from '../src/index';

afterEach(() => setMessageLocale('pt-BR'));

describe('política: mensagens por idioma', () => {
  it('validação de commit: o idioma vem do argumento, sem depender do estado do processo', () => {
    const input = { type: 'feat' as const, subject: '' };
    expect(validateCommitMessage(input).errors).toContain('O título é obrigatório.');
    expect(validateCommitMessage(input, undefined, 'en').errors).toContain('The title is required.');
    setMessageLocale('en');
    expect(validateCommitMessage(input, undefined, 'pt-BR').errors).toContain('O título é obrigatório.');
  });

  it('erros do .gitnexus.json seguem o idioma do processo', () => {
    expect(parseRepoConfig('{').errors[0]).toContain('JSON inválido');
    setMessageLocale('en');
    expect(parseRepoConfig('{').errors[0]).toContain('invalid JSON');
    expect(parseRepoConfig('{"commit":{"maxSubjectLength":1}}').errors).toContain('"commit.maxSubjectLength" must be an integer between 10 and 200.');
  });
});
