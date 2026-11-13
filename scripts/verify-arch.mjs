#!/usr/bin/env node
// Garante que o app empacotado só contém binários de 64 bits (PE, ELF e Mach-O).
//   node scripts/verify-arch.mjs <pasta-release> [x64|arm64]
// Examina as pastas "*-unpacked" (Windows/Linux) e "mac*" (macOS) geradas pelo electron-builder.
// Falha se achar QUALQUER binário 32 bits; binário de outra arquitetura 64 bits só gera aviso.

import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Descreve o binário: { format, arch, bits } ou null se não for um executável reconhecido. */
export function inspectHeader(b) {
  if (b.length < 64) return null;
  // PE (Windows): "MZ" + e_lfanew -> "PE\0\0" + Machine
  if (b[0] === 0x4d && b[1] === 0x5a) {
    const off = b.readUInt32LE(0x3c);
    if (off + 6 > b.length || b.readUInt32LE(off) !== 0x00004550) return null;
    const m = b.readUInt16LE(off + 4);
    const map = { 0x14c: ['x86', 32], 0x8664: ['x64', 64], 0xaa64: ['arm64', 64], 0x1c0: ['arm', 32], 0x1c4: ['arm', 32] };
    const [arch, bits] = map[m] ?? [`0x${m.toString(16)}`, 0];
    return { format: 'PE', arch, bits };
  }
  // ELF: classe (1 = 32 bits, 2 = 64 bits) + e_machine
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) {
    const bits = b[4] === 1 ? 32 : 64;
    const m = b[5] === 2 ? b.readUInt16BE(18) : b.readUInt16LE(18);
    const arch = { 0x3e: 'x64', 0xb7: 'arm64', 0x03: 'x86', 0x28: 'arm' }[m] ?? `0x${m.toString(16)}`;
    return { format: 'ELF', arch, bits };
  }
  // Mach-O (thin) e fat/universal
  const magicBE = b.readUInt32BE(0);
  const cpu = (t) => ({ 7: ['x86', 32], 0x01000007: ['x64', 64], 12: ['arm', 32], 0x0100000c: ['arm64', 64] })[t] ?? [`0x${t.toString(16)}`, 0];
  if (magicBE === 0xfeedfacf || magicBE === 0xfeedface) {
    const [arch, bits] = cpu(b.readUInt32BE(4));
    return { format: 'Mach-O', arch, bits };
  }
  if (b.readUInt32LE(0) === 0xfeedfacf || b.readUInt32LE(0) === 0xfeedface) {
    const [arch, bits] = cpu(b.readUInt32LE(4));
    return { format: 'Mach-O', arch, bits };
  }
  if (magicBE === 0xcafebabe) {
    const n = b.readUInt32BE(4);
    if (n > 8) return null; // provável arquivo .class do Java
    const archs = [];
    for (let i = 0; i < n; i++) archs.push(cpu(b.readUInt32BE(8 + i * 20)));
    return { format: 'Mach-O fat', arch: archs.map((a) => a[0]).join('+'), bits: archs.some((a) => a[1] === 32) ? 32 : 64 };
  }
  return null;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isDirectory()) yield* walk(p);
    else if (s.isFile() && s.size >= 64) yield p;
  }
}

/** Abre o arquivo; antivírus recém-varrendo um .exe gerado pode negar a leitura por alguns segundos (EPERM/EBUSY). */
function openWithRetry(path, attempts = 15) {
  for (let i = 1; ; i++) {
    try {
      return openSync(path, 'r');
    } catch (e) {
      if (i >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); // espera 2 s
    }
  }
}

function head(path) {
  const fd = openWithRetry(path);
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function scan(root, expected) {
  const bad = [];
  const warn = [];
  let count = 0;
  for (const file of walk(root)) {
    const h = inspectHeader(head(file));
    if (!h) continue;
    count++;
    if (h.bits !== 64) bad.push(`${file}  [${h.format} ${h.arch}]`);
    else if (expected && !h.arch.split('+').includes(expected)) warn.push(`${file}  [${h.format} ${h.arch}]`);
  }
  return { count, bad, warn };
}

function main() {
  const [, , releaseDir, expected] = process.argv;
  if (!releaseDir) {
    console.error('Uso: verify-arch.mjs <pasta-release> [x64|arm64]');
    process.exit(2);
  }
  const roots = readdirSync(releaseDir)
    .filter((n) => (n.endsWith('-unpacked') || n.startsWith('mac')) && statSync(join(releaseDir, n)).isDirectory())
    .map((n) => join(releaseDir, n));
  if (!roots.length) {
    console.error(`Nenhuma pasta *-unpacked / mac* em ${releaseDir}`);
    process.exit(2);
  }
  let failed = false;
  for (const root of roots) {
    const r = scan(root, expected);
    console.log(`${root}: ${r.count} binários verificados`);
    for (const w of r.warn) console.warn(`  aviso (arquitetura diferente de ${expected}): ${w}`);
    for (const b of r.bad) console.error(`  ERRO binário 32 bits: ${b}`);
    if (r.bad.length || r.count === 0) failed = true;
  }
  if (failed) process.exit(1);
  console.log('OK: apenas binários de 64 bits.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
