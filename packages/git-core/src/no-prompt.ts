// Ambiente dos comandos git que falam com o remoto: nunca perguntam nada, falham logo (o app não tem terminal para responder).
// Fica num módulo próprio para a ponte de credenciais (askpass.ts) e o resumo do repositório (repo-status.ts) não se importarem em círculo.

/** Sem terminal: nunca pergunta senha (o git falha em vez de travar esperando entrada). */
export const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
