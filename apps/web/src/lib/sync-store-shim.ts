// React 19 bringt `useSyncExternalStore` selbst mit; der Shim aus `use-sync-external-store` (React 16/17) wird im Bündel überflüssig (siehe `vite.config.ts`).
export { useSyncExternalStore } from "react";
