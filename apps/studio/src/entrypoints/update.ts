// Verificação de atualização (processo principal). Uma única consulta GET à API pública do GitHub, sem enviar
// nenhum dado do usuário nem identificador: só o User-Agent genérico exigido pela API.
import type { UpdateInfo } from '@git-nexus/git-core/pure';
import { UPDATE_REPO, compareVersions, pickAsset, type ReleaseAsset } from '../shared/update';

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
}

export interface CheckContext {
  current: string;
  platform: string;
  arch: string;
  portable: boolean;
  /** Para testes. */
  fetchImpl?: typeof fetch;
  repo?: string;
}

export async function checkForUpdate(ctx: CheckContext): Promise<UpdateInfo> {
  const repo = ctx.repo ?? process.env.GITNEXUS_UPDATE_REPO ?? UPDATE_REPO;
  const f = ctx.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitNexus-update-check', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { status: 'unavailable', current: ctx.current, message: 'Sem conexão com o GitHub.' };
  }
  if (res.status === 404) return { status: 'unavailable', current: ctx.current, message: 'Nenhuma release pública encontrada (o repositório pode ser privado).' };
  if (!res.ok) return { status: 'unavailable', current: ctx.current, message: `O GitHub respondeu ${res.status}.` };

  const rel = (await res.json()) as GithubRelease;
  if (rel.draft || rel.prerelease) return { status: 'up-to-date', current: ctx.current };
  const cmp = compareVersions(rel.tag_name, ctx.current);
  if (cmp === null) return { status: 'unavailable', current: ctx.current, message: `Versão fora do padrão: ${rel.tag_name}` };
  if (cmp <= 0) return { status: 'up-to-date', current: ctx.current, latest: rel.tag_name.replace(/^v/, '') };

  const asset = pickAsset(rel.assets ?? [], { platform: ctx.platform, arch: ctx.arch, portable: ctx.portable });
  return {
    status: 'available',
    current: ctx.current,
    latest: rel.tag_name.replace(/^v/, ''),
    url: rel.html_url,
    downloadUrl: asset?.browser_download_url,
    assetName: asset?.name,
    notes: (rel.body ?? '').slice(0, 6000),
    publishedAt: rel.published_at ?? undefined,
  };
}
