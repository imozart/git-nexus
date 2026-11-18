// Mensagens do núcleo em inglês. Parcial é aceito: o que faltar cai no português (pt-BR.ts).
import type { MessageKey } from './pt-BR.js';

const messages: Partial<Record<MessageKey, string>> = {
  'lfs.notUsed': 'This repository does not use Git LFS.',
  'lfs.notInstalled': 'Git LFS is not installed on this computer. Install it (git-lfs.com) to download the files.',
  'lfs.notLfsFiles': 'Those files are not Git LFS files.',
  'lfs.allDownloaded': 'All LFS files are already downloaded.',
  'lfs.downloadFailed': 'Could not download the Git LFS files.',
  'lfs.downloaded': 'Downloaded. Still pointers: {pointers}.',
  'search.tooLong': 'The search text is longer than {max} characters.',
  'search.badRegex': 'Invalid regular expression: {detail}',
  'search.failed': 'The search failed.',
  'search.outsideRepo': 'File outside the repository.',
};

export default messages;
