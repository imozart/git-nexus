# Testes de interface

Dois modos, com a mesma biblioteca (`lib.mjs`: conecta por CDP e oferece `ev`, `key`, `until`, `check`, `shot`…):

| | `run.mjs` (`pnpm test:ui`) | `run-electron.mjs` (`pnpm test:e2e`) |
|---|---|---|
| O que abre | o **renderer** num Chrome/Edge headless, ligado a um *harness* | o **app empacotado**, na janela real do Electron |
| Processo principal, preload, IPC | não (o harness substitui) | **sim** |
| Worker (UtilityProcess) e `git` | git real, mas fora do worker | **sim, tudo real** |
| Carregamento | `http://127.0.0.1` | `file://` do pacote |
| Velocidade | segundos por arquivo | ~15 s por arquivo |
| Testes em | `tests/` | `tests-electron/` |
| Para que serve | telas, atalhos e fluxos da interface | provar que o **pacote** funciona de ponta a ponta |

O smoke test (`GITNEXUS_SMOKE=1`, `src/entrypoints/smoke.ts`) é mais simples que os dois: só confere que a janela abre e que **uma** chamada atravessa a ponte.

## Rodar

```bash
pnpm --filter @git-nexus/studio build && pnpm test:ui            # renderer em navegador headless (precisa de Chrome/Edge: CHROME_PATH)
pnpm --filter @git-nexus/studio pack:dir && pnpm test:e2e        # janela real (empacota sem instalador e abre o app)
pnpm test:e2e fluxo                                              # só os testes cujo nome tem "fluxo"
pnpm test:e2e C:\caminho\GitNexus.exe                            # outro executável
```

O executável é achado sozinho em `apps/studio/release/<sistema>-unpacked` (ou `GN_APP_EXE`). Capturas de tela em `GN_UI_OUT`.
Um arquivo que falha é repetido **uma** vez: partida a frio (navegador ou app novo, máquina lenta ou antivírus segurando o executável recém-gerado) dá falso negativo.

Cada teste do modo real abre uma instância **nova** do app, com uma pasta de dados nova (`GITNEXUS_DATA_DIR`), então um não enxerga o estado do outro nem o seu app instalado.

## No CI

- `ui-tests.yml` roda o modo do navegador headless.
- `smoke.yml` empacota o app, confere que abre (smoke) e em seguida roda o modo da janela real **sobre o mesmo pacote**, sem build extra. No Linux usa `xvfb-run` e
  `GN_APP_ARGS="--no-sandbox --disable-gpu"` (o `chrome-sandbox` do build descompactado não tem o bit SUID).

## Escrever um teste do modo real

Copie `tests-electron/fluxo-completo.mjs`. Use `mkRepo` para criar um repositório de verdade, `t.openRepo` para catalogá-lo e abri-lo, `t.until` para esperar a tela, `git(repo, …)` para
**conferir no git** o que a interface fez (é a verificação que vale), e termine com `t.errors().length === 0` (nenhum erro no console) e `t.close()`.
Regras: não dependa de diálogos nativos (o app não os expõe ao CDP); use `t.ev` para clicar quando o foco não importar e `t.key` quando o teste for sobre o teclado.
