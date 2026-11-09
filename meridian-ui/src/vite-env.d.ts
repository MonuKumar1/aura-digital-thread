/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface Window {
  __ENV__?: { API_BASE_URL?: string; USE_MOCK?: string };
}
