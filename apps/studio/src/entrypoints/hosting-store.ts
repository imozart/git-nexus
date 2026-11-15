// Armazenamento dos tokens de GitHub/GitLab no processo principal. O token é criptografado com `safeStorage`
// (DPAPI no Windows, Keychain no macOS, libsecret/kwallet no Linux) e só o texto cifrado vai para o disco;
// o renderer nunca recebe o token de volta. Sem criptografia disponível, o token só vive na memória (até fechar o app).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import type { ProviderKind } from '@git-nexus/git-core/pure';
import type { TokenStore } from '../worker/hosting-service';

interface Entry {
  kind?: ProviderKind;
  /** Token cifrado, em base64. */
  token?: string;
}
type Data = Record<string, Entry>;

export class SecureTokenStore implements TokenStore {
  private readonly memory = new Map<string, string>();

  constructor(private readonly file: string) {}

  private read(): Data {
    try {
      return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Data) : {};
    } catch {
      return {};
    }
  }

  private write(d: Data): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  secure = () => safeStorage.isEncryptionAvailable();

  async getToken(host: string): Promise<string | undefined> {
    const mem = this.memory.get(host);
    if (mem) return mem;
    const enc = this.read()[host]?.token;
    if (!enc || !this.secure()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return undefined; // cifrado por outra conta/máquina: pede o token de novo
    }
  }

  async setToken(host: string, token: string): Promise<void> {
    if (!this.secure()) {
      this.memory.set(host, token);
      return;
    }
    const d = this.read();
    d[host] = { ...d[host], token: safeStorage.encryptString(token).toString('base64') };
    this.write(d);
  }

  async removeToken(host: string): Promise<void> {
    this.memory.delete(host);
    const d = this.read();
    if (d[host]) {
      delete d[host]!.token;
      this.write(d);
    }
  }

  async getKind(host: string): Promise<ProviderKind | undefined> {
    return this.read()[host]?.kind;
  }

  async setKind(host: string, kind: ProviderKind): Promise<void> {
    const d = this.read();
    d[host] = { ...d[host], kind };
    this.write(d);
  }
}
