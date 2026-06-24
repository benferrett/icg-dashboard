import { useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";

function App() {
  // Session token lives in React state only (no localStorage in sandbox iframe).
  const [token, setToken] = useState<string | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {token ? (
          <DashboardPage
            token={token}
            onLogout={() => {
              queryClient.clear();
              setToken(null);
            }}
          />
        ) : (
          <LoginPage onAuth={setToken} />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
