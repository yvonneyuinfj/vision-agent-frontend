/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAGFLOW_ENABLED?: string;
  readonly VITE_RAGFLOW_PROXY?: string;
  readonly VITE_RAGFLOW_CHAT_ID?: string;
  readonly VITE_RAGFLOW_DATASET_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
