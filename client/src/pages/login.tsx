import { useState } from "react";
import { login } from "@/lib/api";
import { Logo } from "@/components/dashboard/Logo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2 } from "lucide-react";

export default function LoginPage({ onAuth }: { onAuth: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const token = await login(password);
      onAuth(token);
    } catch (err) {
      setError((err as Error).message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={48} className="text-primary" />
          <div>
            <h1 className="text-base font-semibold">Inner Circle Group</h1>
            <p className="text-sm text-muted-foreground">Business Dashboard</p>
          </div>
        </div>

        <form onSubmit={submit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="pl-9"
                autoFocus
                data-testid="input-password"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="text-error">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !password} data-testid="button-login">
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
