// ConnectionsPanel (v1.44, ADR-054) — connect / disconnect the signed-in user's own Jira &
// GitHub. Tokens are typed once and sent to the server; they are never displayed back
// (only a masked "…last4" hint). Reports status changes up so the login gate / Connections tab
// can re-resolve readiness. (Folder name is historical — this panel is app-wide infrastructure.)

import { useEffect, useState, type FormEvent } from "react";
import { Link2, Github, Sparkles, CheckCircle2, AlertCircle, Loader2, Trash2, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getConnections, putJiraConnection, putGithubConnection, putAiConnection, deleteConnection,
  type ConnectionsStatus,
} from "../../lib/connectionsClient";
import { isAuthApiError } from "../../lib/authClient";

function errMsg(err: unknown): string {
  return isAuthApiError(err) ? err.message : "Something went wrong";
}

/**
 * v1.46 (ADR-056): this connection is borrowed from another user (shared credentials). The user
 * can't disconnect it — they can only add a token of their own, which then takes precedence.
 */
function SharedNotice({ via, provider }: { via: string; provider: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-foreground flex items-center gap-1.5">
        <Share2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" aria-hidden="true" />
        Shared from <span className="font-medium">{via}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        You're using {via}'s {provider}. Connect your own token below to use your identity instead.
      </p>
    </div>
  );
}

export function ConnectionsPanel({ onStatusChange }: { onStatusChange?: (s: ConnectionsStatus) => void }) {
  const [status, setStatus] = useState<ConnectionsStatus | null>(null);
  const [loading, setLoading] = useState(true);

  function apply(s: ConnectionsStatus) {
    setStatus(s);
    onStatusChange?.(s);
  }

  useEffect(() => {
    getConnections()
      .then((s) => { apply(s); })
      .catch(() => { /* leave null; the gate handles auth errors */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading connections…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <JiraCard status={status} onApply={apply} />
      <GithubCard status={status} onApply={apply} />
      <AiCard status={status} onApply={apply} />
    </div>
  );
}

// ── Jira ─────────────────────────────────────────────────────────────────────

function JiraCard({ status, onApply }: { status: ConnectionsStatus | null; onApply: (s: ConnectionsStatus) => void }) {
  const jira = status?.jira ?? null;
  const owned = !!jira && !jira.inherited; // borrowed connections can't be disconnected
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      onApply(await putJiraConnection(baseUrl.trim(), email.trim(), token.trim()));
      setToken("");
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(null);
    try { onApply(await deleteConnection("jira")); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Link2 className="h-4 w-4 text-primary" aria-hidden="true" /> Jira
          {jira && <CheckCircle2 className="h-4 w-4 text-success ml-auto" aria-label="Connected" />}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {owned && jira ? (
          <div className="space-y-2 text-sm">
            <p className="text-foreground break-all">{jira.baseUrl}</p>
            <p className="text-muted-foreground">{jira.email} · token {jira.hint}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Disconnect
            </Button>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        ) : (
          <form onSubmit={(e) => void connect(e)} className="space-y-2">
            {jira?.inherited && <SharedNotice via={jira.via ?? "an admin"} provider="Jira" />}
            <div>
              <Label htmlFor="jira-base" className="text-xs font-semibold">Jira base URL</Label>
              <Input id="jira-base" type="url" placeholder="https://you.atlassian.net" required
                value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="jira-email" className="text-xs font-semibold">Email</Label>
              <Input id="jira-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="jira-token" className="text-xs font-semibold">API token</Label>
              <Input id="jira-token" type="password" autoComplete="off" required
                value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
              Connect Jira
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── GitHub ───────────────────────────────────────────────────────────────────

function GithubCard({ status, onApply }: { status: ConnectionsStatus | null; onApply: (s: ConnectionsStatus) => void }) {
  const github = status?.github ?? null;
  const owned = !!github && !github.inherited;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onApply(await putGithubConnection(token.trim())); setToken(""); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(null);
    try { onApply(await deleteConnection("github")); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Github className="h-4 w-4 text-primary" aria-hidden="true" /> GitHub
          {github && <CheckCircle2 className="h-4 w-4 text-success ml-auto" aria-label="Connected" />}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {owned && github ? (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">@{github.login} · token {github.hint}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Disconnect
            </Button>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        ) : (
          <form onSubmit={(e) => void connect(e)} className="space-y-2">
            {github?.inherited && <SharedNotice via={github.via ?? "an admin"} provider="GitHub" />}
            <div>
              <Label htmlFor="gh-token" className="text-xs font-semibold">Personal access token</Label>
              <Input id="gh-token" type="password" autoComplete="off" required placeholder="ghp_…"
                value={token} onChange={(e) => setToken(e.target.value)} />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">Optional for now — stored securely for later use.</p>
            </div>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
              Connect GitHub
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── AI ───────────────────────────────────────────────────────────────────────

function AiCard({ status, onApply }: { status: ConnectionsStatus | null; onApply: (s: ConnectionsStatus) => void }) {
  const ai = status?.ai ?? null;
  const owned = !!ai && !ai.inherited;
  const [provider, setProvider] = useState<"anthropic" | "github">("github");
  const [token, setToken] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onApply(await putAiConnection(provider, token.trim(), model.trim() || undefined)); setToken(""); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(null);
    try { onApply(await deleteConnection("ai")); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> AI
          {ai && <CheckCircle2 className="h-4 w-4 text-success ml-auto" aria-label="Connected" />}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {owned && ai ? (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">{ai.provider} · {ai.model}</p>
            <p className="text-muted-foreground">token {ai.hint}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Disconnect
            </Button>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        ) : (
          <form onSubmit={(e) => void connect(e)} className="space-y-2">
            {ai?.inherited && <SharedNotice via={ai.via ?? "an admin"} provider="AI token" />}
            <div>
              <Label htmlFor="ai-provider" className="text-xs font-semibold">Provider</Label>
              <select
                id="ai-provider"
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value as "anthropic" | "github")}
              >
                <option value="github">GitHub Models</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div>
              <Label htmlFor="ai-token" className="text-xs font-semibold">
                {provider === "github" ? "GitHub token (Models: read)" : "Anthropic API key"}
              </Label>
              <Input id="ai-token" type="password" autoComplete="off" required
                value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ai-model" className="text-xs font-semibold">
                Model <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="ai-model" placeholder={provider === "github" ? "openai/gpt-4o-mini" : "claude-opus-4-8"}
                value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
              Connect AI
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
