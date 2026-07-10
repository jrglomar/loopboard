// AppGate (v1.45, ADR-055) — the app-wide entry gate. No page is reachable until the user
// signs in AND connects the required accounts (Jira + GitHub). Order: login → connect accounts →
// app. When the required connections land, `ready` flips and the app unlocks automatically.

import { type ReactNode } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "../context/AuthContext";
import { LoginForm } from "./task-helper/LoginForm";
import { ConnectionsPanel } from "./task-helper/ConnectionsPanel";

function Brand() {
  return (
    <div className="flex items-center gap-2 justify-center py-6">
      <span className="text-xl font-bold tracking-tight">
        <span className="text-foreground">Loop</span><span className="text-primary">board</span>
      </span>
    </div>
  );
}

function NotEnabled() {
  return (
    <div className="max-w-md mx-auto mt-16">
      <Brand />
      <Card className="shadow-sm">
        <CardContent className="px-5 py-6 text-sm text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Loopboard isn't configured for accounts yet.</p>
          <p>
            Ask an admin to set <code className="font-mono text-xs">TOKEN_ENC_KEY</code> and{" "}
            <code className="font-mono text-xs">SESSION_SECRET</code> on the server (see docs/SETUP.md),
            then restart it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Onboarding({ email, onLogout, onChange }: {
  email: string;
  onLogout: () => void;
  onChange: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Connect your accounts</h1>
          <p className="text-sm text-muted-foreground">
            Loopboard runs on your own Jira &amp; GitHub. Connect them to unlock the app.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Signed in as <span className="text-foreground font-medium">{email}</span></span>
          <Button type="button" variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Log out
          </Button>
        </div>
      </div>
      <ConnectionsPanel onStatusChange={() => onChange()} />
      <p className="text-sm text-muted-foreground">
        Once your <span className="font-medium text-foreground">Jira and GitHub</span> are connected, the app
        unlocks automatically. (Your AI token powers the Task Helper.)
      </p>
    </div>
  );
}

export function AppGate({ children }: { children: ReactNode }) {
  const { user, loading, unavailable, ready, refreshContext, logout } = useAuth();

  if (unavailable) return <NotEnabled />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin mr-2" aria-hidden="true" /> Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <Brand />
        <LoginForm />
      </div>
    );
  }

  if (!ready) {
    return <Onboarding email={user.email} onLogout={() => void logout()} onChange={() => void refreshContext()} />;
  }

  return <>{children}</>;
}
