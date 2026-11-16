// Label "sem-release": um PR com ela, ao ser aceito, não publica release. Os commits dele ficam depois da última tag e entram na release seguinte
// (versão e CHANGELOG contam tudo o que veio desde a última versão estável). Núcleo PURO, sem dependências.
//
// É a segunda forma de pular uma release. A primeira, `[skip release]` na mensagem do merge, continua valendo (release.yml): as duas se somam.

export const SKIP_LABEL = 'sem-release';

/** `prs`: `[{ number, labels: ['nome', ...] }]` dos PRs ligados ao commit da main. Devolve os números dos que pedem para pular. */
export function skipRequestedBy(prs) {
  return prs.filter((p) => (p.labels ?? []).includes(SKIP_LABEL)).map((p) => p.number);
}
