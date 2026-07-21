// Connections page (v1.47, ADR-057) — manage the signed-in user's own Jira / GitHub / AI tokens.
// Split out into its own tab so account setup lives in one obvious place.
//
// Tokens are typed once and sent to the server; they are never displayed back (only a masked
// "…last4" hint). A connection inherited from a credential source (ADR-056) shows its origin and
// can't be disconnected — connecting your own token takes precedence.
//
// v1.67 (ADR-078): adds an "Account" card — self-service password change for the signed-in user
// (any role). This page is already app-wide / not role-gated, so both "user" and "admin" see it.
// Distinct from the admin's "reset a user's password" (Admin.tsx): this one requires the CURRENT
// password first, since it's the account holder acting on themselves rather than an admin resetting.

import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "../context/AuthContext";
import { ConnectionsPanel } from "../components/task-helper/ConnectionsPanel";
import { changePassword, isAuthApiError } from "../lib/authClient";

function errMsg(err: unknown): string {
  return isAuthApiError(err) ? err.message : "Something went wrong";
}

function AccountCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Password updated.");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" /> Account
        </h3>
        <p className="text-xs text-muted-foreground">Change your own password.</p>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={(e) => void submit(e)} className="space-y-2 max-w-sm">
          <div>
            <Label htmlFor="acct-current-password" className="text-xs font-semibold">Current password</Label>
            <Input id="acct-current-password" type="password" required minLength={8} autoComplete="current-password"
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="acct-new-password" className="text-xs font-semibold">New password</Label>
            <Input id="acct-new-password" type="password" required minLength={8} autoComplete="new-password"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1" role="alert">
              <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
            </p>
          )}
          {notice && (
            <p className="text-xs text-success flex items-center gap-1" role="status">
              <CheckCircle2 className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {notice}
            </p>
          )}
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function Connections() {
  const { refreshContext, sharedFrom, readOnly } = useAuth();

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect your own Jira, GitHub and AI accounts. Tokens are encrypted at rest and never shown again.
        </p>
      </div>

      {sharedFrom && (
        <p className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
          You're currently using <span className="font-medium text-foreground">{sharedFrom}</span>'s credentials
          {readOnly ? " and can view but not change Jira" : ""}. Connect your own token below to act as yourself.
        </p>
      )}

      {/* Re-resolve readiness/role after any change, so the gate + header stay accurate. */}
      <ConnectionsPanel onStatusChange={() => void refreshContext()} />

      <AccountCard />
    </div>
  );
}
