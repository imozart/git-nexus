import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { inspectHeader, scan } from '../verify-arch.mjs';

function pe(machine: number): Buffer {
  const b = Buffer.alloc(256);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);
  b.writeUInt16LE(machine, 0x84);
  return b;
}
function elf(cls: 1 | 2, machine: number): Buffer {
  const b = Buffer.alloc(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, cls, 1], 0);
  b.writeUInt16LE(machine, 18);
  return b;
}
function macho(cpu: number): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cpu, 4);
  return b;
}
function fat(...cpus: number[]): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0xcafebabe, 0);
  b.writeUInt32BE(cpus.length, 4);
  cpus.forEach((c, i) => b.writeUInt32BE(c, 8 + i * 20));
  return b;
}

describe('inspectHeader', () => {
  it('PE', () => {
    expect(inspectHeader(pe(0x8664))).toMatchObject({ arch: 'x64', bits: 64 });
    expect(inspectHeader(pe(0xaa64))).toMatchObject({ arch: 'arm64', bits: 64 });
    expect(inspectHeader(pe(0x14c))).toMatchObject({ arch: 'x86', bits: 32 });
  });
  it('ELF', () => {
    expect(inspectHeader(elf(2, 0x3e))).toMatchObject({ arch: 'x64', bits: 64 });
    expect(inspectHeader(elf(2, 0xb7))).toMatchObject({ arch: 'arm64', bits: 64 });
    expect(inspectHeader(elf(1, 0x03))).toMatchObject({ arch: 'x86', bits: 32 });
  });
  it('Mach-O thin e fat', () => {
    expect(inspectHeader(macho(0x0100000c))).toMatchObject({ arch: 'arm64', bits: 64 });
    expect(inspectHeader(fat(0x01000007, 0x0100000c))).toMatchObject({ arch: 'x64+arm64', bits: 64 });
    expect(inspectHeader(fat(7, 0x01000007))).toMatchObject({ bits: 32 });
  });
  it('ignora o que não é executável', () => {
    expect(inspectHeader(Buffer.alloc(128, 0x41))).toBeNull();
  });
});

describe('scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-arch-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('aprova pasta só com 64 bits e reprova com um binário 32 bits', () => {
    mkdirSync(join(root, 'ok', 'sub'), { recursive: true });
    writeFileSync(join(root, 'ok', 'app.exe'), pe(0x8664));
    writeFileSync(join(root, 'ok', 'sub', 'a.dll'), pe(0x8664));
    writeFileSync(join(root, 'ok', 'texto.txt'), 'x'.repeat(200));
    expect(scan(join(root, 'ok'), 'x64')).toMatchObject({ count: 2, bad: [], warn: [] });

    mkdirSync(join(root, 'ruim'));
    writeFileSync(join(root, 'ruim', 'launcher.exe'), pe(0x14c));
    writeFileSync(join(root, 'ruim', 'app.exe'), pe(0x8664));
    const r = scan(join(root, 'ruim'), 'x64');
    expect(r.bad).toHaveLength(1);
    expect(r.bad[0]).toContain('launcher.exe');
  });

  it('arquitetura 64 bits diferente só gera aviso', () => {
    mkdirSync(join(root, 'misto'));
    writeFileSync(join(root, 'misto', 'x.dll'), pe(0x8664));
    const r = scan(join(root, 'misto'), 'arm64');
    expect(r.bad).toEqual([]);
    expect(r.warn).toHaveLength(1);
  });
});
