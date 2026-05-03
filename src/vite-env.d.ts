/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUMPPORTAL_API_KEY?: string;
  readonly VITE_PUMPPORTAL_WS_PUBLIC_ONLY?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_CHAT_SIMULATE?: string;
  readonly VITE_GITHUB_UPSTREAM_OWNER?: string;
  readonly VITE_GITHUB_UPSTREAM_REPO?: string;
  /** Landing page “GitHub” button — full URL to your public repo */
  readonly VITE_GITHUB_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
