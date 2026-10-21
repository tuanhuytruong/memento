/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Local-only upload diagnostics; enabled only when built with VITE_UPLOAD_DIAGNOSTICS=true. */
  readonly VITE_UPLOAD_DIAGNOSTICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
