// Connections page (v1.47, ADR-057) — manage the signed-in user's own Jira / GitHub / AI tokens.
// Split out of the Task Helper so account setup lives in one obvious place.
//
// Tokens are typed once and sent to the server; they are never displayed back (only a masked
// "…last4" hint). A connection inherited from a credential source (ADR-056) shows its origin and
// can't be disconnected — connecting your own token takes precedence.

import { useAuth } from "../context/AuthContext";
import { ConnectionsPanel } from "../components/task-helper/ConnectionsPanel";

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
    </div>
  );
}
