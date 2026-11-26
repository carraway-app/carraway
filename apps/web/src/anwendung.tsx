import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { SpracheProvider } from "./i18n";
import type { erstelleRouter } from "./router";

export function Anwendung({ queryClient, router }: { queryClient: QueryClient; router: ReturnType<typeof erstelleRouter> }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SpracheProvider>
        <RouterProvider router={router} />
      </SpracheProvider>
    </QueryClientProvider>
  );
}
