/// <reference types="vite/client" />
import type { GitNexusApi } from '@git-nexus/git-core/pure';

declare global {
  interface Window {
    gitNexus: GitNexusApi;
  }
}

export {};
