# Origem dos arquivos de fonte

Fonte: **JetBrains Mono v2.304** (a última versão publicada, 14/01/2023), licença **SIL Open Font License 1.1** (`OFL.txt`, nesta pasta).

- Release oficial: https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304
- Asset: `JetBrainsMono-2.304.zip` (pasta `fonts/webfonts/`)
- Os arquivos são usados **sem modificação** (sem subconjunto de glifos, sem renomear, sem converter formato): a licença exige outro nome para versões modificadas.
- Só estas quatro faces entram no app (ele não usa itálico nem outros pesos).

| Arquivo | Peso | SHA-256 |
|---|---|---|
| `JetBrainsMono-Regular.woff2` | 400 | `a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2` |
| `JetBrainsMono-Medium.woff2` | 500 | `086c48dfbea9ddaff1320f7e09399b8e2924e88ce67453721255db3bdbb5a353` |
| `JetBrainsMono-SemiBold.woff2` | 600 | `918edad542a1da608fd2ba8daebaff9ac802309103fe760eed465b8b4e47faf1` |
| `JetBrainsMono-Bold.woff2` | 700 | `c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2` |

O teste `apps/ui-kit/test/fonts.test.ts` confere a assinatura e o SHA-256 de cada arquivo contra esta tabela.

Para atualizar a fonte: baixar o novo release oficial, trocar os quatro arquivos e o `OFL.txt`, recalcular os SHA-256 aqui e atualizar o `THIRD_PARTY_NOTICES.md` (na raiz do repositório).
