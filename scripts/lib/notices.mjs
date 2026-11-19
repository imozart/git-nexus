// Avisos de terceiros: a parte pura (sem rede e sem varrer disco além do que o chamador entrega), para testar.
// O script scripts/third-party-notices.mjs junta isto com a leitura do node_modules.

/** Licenças das bibliotecas embutidas que o GitNexus (GPL-3.0-only) aceita: todas permissivas e compatíveis com a GPL-3.0. */
export const ALLOWED_LICENSES = ['0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'Python-2.0', 'Unlicense', 'Zlib'];

/** Marcas da região gerada dentro de THIRD_PARTY_NOTICES.md: o que está fora delas é escrito à mão. */
export const BEGIN = '<!-- GERADO:INICIO (scripts/third-party-notices.mjs; não edite à mão) -->';
export const END = '<!-- GERADO:FIM -->';

/** Ferramentas de build, teste e empacotamento: não entram nos bundles distribuídos. O Electron traz as próprias licenças (LICENSE.electron.txt, LICENSES.chromium.html). */
const TOOL_NAMES = new Set(['electron', 'electron-builder', 'esbuild', 'vite', 'sass', 'typescript', 'vue-tsc', 'vitest', '@vitejs/plugin-vue', '@vitest/coverage-v8']);
export const isBuildTool = (name) => TOOL_NAMES.has(name) || name.startsWith('@types/');

/** O campo de licença do package.json (string SPDX, `{type}` ou o antigo `licenses: [{type}]`) → expressão SPDX, ou null. */
export function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license.trim() || null;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type.trim() || null;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    const types = pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    return types.length ? types.join(' OR ') : null;
  }
  return null;
}

/** A expressão SPDX é aceita? `A OR B`: basta uma alternativa permitida; `A AND B`: todas; parênteses só agrupam. Desconhecida (ou vazia) reprova. */
export function isAllowed(expression, allowed = ALLOWED_LICENSES) {
  if (!expression) return false;
  const ok = new Set(allowed);
  const flat = expression.replace(/[()]/g, ' ').trim();
  if (!flat) return false;
  return flat.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((id) => ok.has(id.trim())));
}

/** Ordem estável (nome, depois versão) e sem repetição de nome@versão (o pnpm pode instalar o mesmo pacote em pastas diferentes; fica o que tem mais informação, para não depender da ordem). */
export function sortUnique(items) {
  const info = (it) => (it.text?.length ?? 0) + (it.homepage?.length ?? 0);
  const seen = new Map();
  for (const it of items) {
    const key = `${it.name}@${it.version}`;
    const prev = seen.get(key);
    if (!prev || info(it) > info(prev)) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', { numeric: true }));
}

const fence = (text) => {
  const body = text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const ticks = '`'.repeat(Math.max(3, (body.match(/`+/g) ?? []).reduce((n, s) => Math.max(n, s.length), 0) + 1));
  return `${ticks}text\n${body}\n${ticks}`;
};

/** Texto da região gerada: sumário por pacote e, depois, o texto da licença de cada um (o aviso de copyright que MIT/BSD/Apache pedem). */
export function renderGenerated(items) {
  const list = sortUnique(items);
  const out = [];
  out.push('## Bibliotecas JavaScript embutidas nos pacotes', '');
  out.push(`O aplicativo empacota ${list.length} bibliotecas (as dependências de execução do que entra nos bundles do Electron, direta e transitivamente). Cada uma segue a licença abaixo; os textos vêm do próprio pacote.`, '');
  out.push('| Biblioteca | Versão | Licença |', '|---|---|---|');
  for (const it of list) out.push(`| ${it.name} | ${it.version} | ${it.license} |`);
  out.push('');
  for (const it of list) {
    out.push(`### ${it.name} ${it.version}`, '', `Licença: ${it.license}${it.homepage ? ` · ${it.homepage}` : ''}`, '');
    out.push(it.text ? fence(it.text) : '_O pacote não traz arquivo de licença; vale a identificação acima, do `package.json`._', '');
  }
  return out.join('\n');
}

/** Troca a região gerada de `file` por `generated` (cria a região no fim se ainda não existir). Sempre com fim de linha LF. */
export function mergeGenerated(file, generated) {
  const text = file.replace(/\r\n/g, '\n');
  const block = `${BEGIN}\n\n${generated.replace(/\s+$/, '')}\n\n${END}\n`;
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a !== -1 && b > a) return `${text.slice(0, a)}${block}${text.slice(b + END.length).replace(/^\n/, '')}`;
  return `${text.replace(/\s+$/, '')}\n\n${block}`;
}
