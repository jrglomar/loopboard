// LoginForm (v1.44/v1.48, ADR-054) — the app-wide sign-in / sign-up form, rendered by AppGate.
// v1.48 (UI review COPY-01/A11Y-05): copy addresses the whole app (not just one tab), and
// the form leads with a single <h1> so the entry screen has a valid heading outline.
// (Folder name is historical — this form is app-wide infrastructure.)

import { useState, type FormEvent } from "react";
import { LogIn, UserPlus, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "../../context/AuthContext";
import { isAuthApiError } from "../../lib/authClient";

export function LoginForm() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await signup(email, password);
    } catch (err) {
      setError(isAuthApiError(err) ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-10">
      <Card className="shadow-sm">
        <CardHeader className="px-5 pt-5 pb-2">
          <h1 className="text-lg font-semibold text-foreground">
            {mode === "login" ? "Sign in to Loopboard" : "Create your Loopboard account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Loopboard runs on your own Jira &amp; GitHub — sign in to connect them and open your board.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <div>
              <Label htmlFor="auth-email" className="text-xs font-semibold">Email</Label>
              <Input id="auth-email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="auth-password" className="text-xs font-semibold">
                Password {mode === "signup" && <span className="font-normal text-muted-foreground">(8+ characters)</span>}
              </Label>
              <Input id="auth-password" type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
              ) : mode === "login" ? (
                <LogIn className="h-4 w-4 mr-1.5" aria-hidden="true" />
              ) : (
                <UserPlus className="h-4 w-4 mr-1.5" aria-hidden="true" />
              )}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-3 text-xs text-primary hover:underline"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
          >
            {mode === "login" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
