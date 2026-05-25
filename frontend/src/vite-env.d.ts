/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly BASE_URL: string;
  // Sentry config (opzionali: in dev locale assenti)
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_USER_ID_SALT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
