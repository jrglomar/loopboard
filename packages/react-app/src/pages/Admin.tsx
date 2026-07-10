// Admin console (v1.45/v1.46, ADR-055/056) — the super-admin's supervision + config surface.
// Admin-only (the tab is gated on role in App.tsx; the API is gated by requireAdmin server-side).
//
//  - Add user: create an account, optionally on SHARED credentials — a teammate with no Jira/AI
//    tokens of their own who borrows another user's, getting the same board point-of-view.
//  - Users: role, connection status, shared-credential source, write access, disable, delete,
//    and per-user board/env overrides.
//  - Global defaults: the board/env config applied to everyone (per-user overrides win).
//
// Only NON-secret config is settable here — Jira/GitHub/AI tokens stay each user's own encrypted
// connection and are never shown.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ShieldCheck, User as UserIcon, Loader2, AlertCircle, CheckCircle2, Settings2, RefreshCw,
  UserPlus, Trash2, Ban, Undo2, Share2, Layers, Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isAuthApiError } from "../lib/authClient";
import {
  getAdminUsers, putGlobalConfig, putUserConfig, putUserRole,
  createUser, updateUser, deleteUser,
  getTemplates, createTemplate, deleteTemplate, applyTemplateToUser, applyTemplateToGlobal,
  type AdminConfig, type AdminUser, type AdminUsersResponse, type ConfigTemplate,
} from "../lib/adminClient";

function errMsg(err: unknown): string {
  return isAuthApiError(err) ? err.message : "Something went wrong";
}

// The admin-settable fields, grouped for a legible form. Order/labels mirror adminConfigSchema.
type FieldDef = { key: keyof AdminConfig; label: string; placeholder?: string; numeric?: boolean };
const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Connection defaults",
    fields: [
      { key: "JIRA_BASE_URL", label: "Jira base URL", placeholder: "https://you.atlassian.net" },
      { key: "JIRA_EMAIL", label: "Jira email", placeholder: "you@company.com" },
    ],
  },
  {
    title: "Boards & projects",
    fields: [
      { key: "JIRA_PO_BOARD_ID", label: "PO board ID", placeholder: "10001" },
      { key: "JIRA_DEV_BOARD_ID", label: "Dev board ID", placeholder: "10002" },
      { key: "JIRA_PO_PROJECT_KEY", label: "PO project key", placeholder: "PO" },
      { key: "JIRA_DEV_PROJECT_KEY", label: "Dev project key", placeholder: "DEV" },
      { key: "JIRA_PO_PROJECTS", label: "PO projects (KEY:boardId,…)" },
      { key: "JIRA_DEV_PROJECTS", label: "Dev projects (KEY:boardId,…)" },
    ],
  },
  {
    title: "Fields & statuses",
    fields: [
      { key: "JIRA_STORY_POINTS_FIELD", label: "Story-points field", placeholder: "customfield_10016" },
      { key: "JIRA_LINK_TYPE", label: "Link type", placeholder: "Depends on" },
      { key: "JIRA_FLAGGED_FIELD", label: "Flagged field" },
      { key: "JIRA_CODE_REVIEW_STATUSES", label: "Code-review statuses (comma-sep)" },
      { key: "JIRA_DEV_STATUS_APP_TYPE", label: "Dev-status app type" },
    ],
  },
  {
    title: "Velocity & offset",
    fields: [
      { key: "JIRA_VELOCITY_SPRINTS", label: "Velocity sprints", placeholder: "6", numeric: true },
      { key: "JIRA_REQUIRED_POINTS", label: "Required points", placeholder: "8", numeric: true },
      { key: "JIRA_OFFSET_THRESHOLD", label: "Offset threshold", placeholder: "2", numeric: true },
    ],
  },
];

function toStringMap(cfg: AdminConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of FIELD_GROUPS) {
    for (const f of group.fields) {
      const v = cfg[f.key];
      out[f.key] = v === undefined || v === null ? "" : String(v);
    }
  }
  return out;
}

/**
 * A reusable form over the admin-settable config. Empty fields are OMITTED (clears the override).
 * `idPrefix` keeps DOM ids unique when several of these render on the page at once.
 */
function ConfigForm({
  initial, saving, submitLabel, onSave, idPrefix = "cfg",
}: {
  initial: AdminConfig;
  saving: boolean;
  submitLabel: string;
  onSave: (cfg: AdminConfig) => void;
  idPrefix?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => toStringMap(initial));
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const out: Record<string, string | number> = {};
    for (const group of FIELD_GROUPS) {
      for (const f of group.fields) {
        const raw = (values[f.key] ?? "").trim();
        if (raw === "") continue; // omit → the server drops this override
        out[f.key] = f.numeric ? Number(raw) : raw;
      }
    }
    onSave(out as AdminConfig);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {FIELD_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {group.title}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.fields.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`${idPrefix}-${f.key}`} className="text-xs font-medium">{f.label}</Label>
                <Input
                  id={`${idPrefix}-${f.key}`}
                  inputMode={f.numeric ? "numeric" : undefined}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}

/** How many fields a template actually sets — the useful at-a-glance summary. */
function fieldCount(cfg: AdminConfig): number {
  return Object.values(cfg).filter((v) => v !== undefined && v !== "").length;
}

/**
 * Apply a saved template into a config form (v1.47). "Apply" replaces the target's config with the
 * template's; "Merge" layers the template over whatever is already set.
 */
function TemplatePicker({
  templates, busy, id, scope, onApply,
}: {
  templates: ConfigTemplate[];
  busy: boolean;
  /** Unique DOM id fragment — several pickers can be open at once. */
  id: string;
  /** Human name of what's being changed, e.g. "global defaults" or a user's email. */
  scope: string;
  onApply: (templateId: string, merge: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  if (templates.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 mb-3 pb-3 border-b border-border">
      <div className="min-w-[200px]">
        <Label htmlFor={`tpl-pick-${id}`} className="text-xs font-medium">Apply a template</Label>
        <select
          id={`tpl-pick-${id}`}
          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({fieldCount(t.config)} fields)</option>
          ))}
        </select>
      </div>
      {/* a11y: several pickers coexist, so the action names must say WHAT they change. */}
      <Button type="button" size="sm" variant="outline" disabled={!selected || busy}
        aria-label={`Replace ${scope} config with the selected template`}
        onClick={() => onApply(selected, false)}>
        Replace with template
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={!selected || busy}
        aria-label={`Merge the selected template on top of ${scope} config`}
        onClick={() => onApply(selected, true)}>
        Merge on top
      </Button>
    </div>
  );
}

/** Create / list / delete reusable config templates (v1.47, ADR-057). */
function TemplatesCard({
  templates, busy, creating, onCreate, onDelete,
}: {
  templates: ConfigTemplate[];
  busy: string | null;
  creating: boolean;
  onCreate: (name: string, config: AdminConfig) => void;
  onDelete: (t: ConfigTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-primary" aria-hidden="true" /> Config templates
          {templates.length > 0 && <span className="text-muted-foreground font-normal">({templates.length})</span>}
          <Button type="button" size="sm" variant={open ? "ghost" : "outline"} className="ml-auto"
            onClick={() => setOpen((o) => !o)}>
            {open ? "Cancel" : <><Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> New template</>}
          </Button>
        </h2>
        <p className="text-xs text-muted-foreground">
          Save a board/env setup once, then reuse it on any user's overrides or the global defaults.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {templates.length > 0 ? (
          <ul className="space-y-1.5">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 border border-border rounded-md px-3 py-1.5">
                <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">{t.name}</span>
                <span className="text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {fieldCount(t.config)} fields
                </span>
                {confirmId === t.id ? (
                  <>
                    <Button type="button" size="sm" variant="destructive" disabled={busy === t.id}
                      onClick={() => { onDelete(t); setConfirmId(null); }}>
                      Confirm delete
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="outline" disabled={busy === t.id}
                    aria-label={`Delete template ${t.name}`} onClick={() => setConfirmId(t.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !open && <p className="text-sm text-muted-foreground">No templates yet.</p>
        )}

        {open && (
          <div className="border-t border-border pt-3 space-y-3">
            <div className="max-w-sm">
              <Label htmlFor="tpl-name" className="text-xs font-medium">Template name</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Team A — Dev board" maxLength={80} />
            </div>
            <ConfigForm
              idPrefix="tpl"
              initial={{}}
              saving={creating}
              submitLabel="Create template"
              onSave={(cfg) => {
                if (!name.trim()) return;
                onCreate(name.trim(), cfg);
                setName("");
                setOpen(false);
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={cn(
        "text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap",
        on ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
      )}
      title={on ? `${label} connected` : `${label} not connected`}
    >
      {label}
    </span>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "primary" | "muted" | "warn" | "danger" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    muted: "bg-muted text-muted-foreground",
    warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    danger: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span className={cn("text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap", tones[tone])}>
      {children}
    </span>
  );
}

// ── Add-user form ─────────────────────────────────────────────────────────────

function AddUserCard({
  sources, busy, onCreate,
}: {
  sources: AdminUser[];
  busy: boolean;
  onCreate: (input: { email: string; password: string; role?: "admin" | "user"; credentialSourceUserId?: string; allowWrites?: boolean }) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [sourceId, setSourceId] = useState("");
  const [allowWrites, setAllowWrites] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    onCreate({
      email: email.trim(),
      password,
      role,
      ...(sourceId ? { credentialSourceUserId: sourceId, allowWrites } : {}),
    });
    setEmail(""); setPassword(""); setSourceId(""); setAllowWrites(false); setRole("user");
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" /> Add user
        </h2>
        <p className="text-xs text-muted-foreground">
          Leave “Credentials” on <em>Their own tokens</em> for a normal teammate. Pick a user to share from
          when the new teammate has no Jira/AI tokens — they'll see that user's boards read-only.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
          <div>
            <Label htmlFor="new-email" className="text-xs font-medium">Email</Label>
            <Input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-password" className="text-xs font-medium">Temporary password</Label>
            <Input id="new-password" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-role" className="text-xs font-medium">Role</Label>
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <Label htmlFor="new-source" className="text-xs font-medium">Credentials</Label>
            <select id="new-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Their own tokens</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>Share from {s.email}</option>
              ))}
            </select>
          </div>
          {sourceId && (
            <label className="flex items-center gap-2 text-xs text-foreground sm:col-span-2 lg:col-span-3">
              <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
              Allow this user to change Jira (edits will appear under the token owner's name)
            </label>
          )}
          <Button type="submit" size="sm" disabled={busy} className="lg:col-start-4">
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
            Create user
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Access (shared credentials) panel ─────────────────────────────────────────

function AccessForm({
  user, sources, busy, onSave,
}: {
  user: AdminUser;
  sources: AdminUser[];
  busy: boolean;
  onSave: (input: { credentialSourceUserId: string | null; allowWrites: boolean }) => void;
}) {
  const [sourceId, setSourceId] = useState(user.credentialSourceUserId ?? "");
  const [allowWrites, setAllowWrites] = useState(user.allowWrites);
  const options = sources.filter((s) => s.id !== user.id);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({ credentialSourceUserId: sourceId || null, allowWrites });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`src-${user.id}`} className="text-xs font-medium">Credentials</Label>
          <select id={`src-${user.id}`} value={sourceId} onChange={(e) => setSourceId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Their own tokens</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>Share from {s.email}</option>
            ))}
          </select>
        </div>
      </div>
      {sourceId && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
          Allow Jira changes (writes are attributed to the token owner)
        </label>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
        Save access
      </Button>
    </form>
  );
}

// ── One user row ──────────────────────────────────────────────────────────────

function UserRow({
  user, sources, templates, formEpoch, busy, expanded, confirmingDelete,
  onToggleRole, onToggleExpand, onSaveConfig, onSaveAccess, onSetPassword, onToggleDisabled, onDelete,
  onRequestDelete, onApplyTemplate,
}: {
  user: AdminUser;
  sources: AdminUser[];
  templates: ConfigTemplate[];
  formEpoch: number;
  busy: boolean;
  expanded: boolean;
  confirmingDelete: boolean;
  onToggleRole: (u: AdminUser) => void;
  onToggleExpand: () => void;
  onSaveConfig: (userId: string, cfg: AdminConfig) => void;
  onSaveAccess: (userId: string, input: { credentialSourceUserId: string | null; allowWrites: boolean }) => void;
  onSetPassword: (userId: string, password: string) => void;
  onToggleDisabled: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onRequestDelete: (u: AdminUser | null) => void;
  onApplyTemplate: (userId: string, templateId: string, merge: boolean) => void;
}) {
  const isAdmin = user.role === "admin";
  const [password, setPassword] = useState("");

  return (
    <div className={cn("border rounded-lg", user.disabled ? "border-destructive/30 bg-destructive/[0.03]" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={cn("h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0",
            isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {isAdmin ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : <UserIcon className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span className="text-sm font-medium text-foreground truncate">{user.email}</span>
          <Pill tone={isAdmin ? "primary" : "muted"}>{user.role}</Pill>
          {user.sharedFrom && (
            <Pill tone="warn">
              <Share2 className="h-2.5 w-2.5 inline mr-0.5" aria-hidden="true" />
              shared from {user.sharedFrom}
            </Pill>
          )}
          {user.readOnly && <Pill tone="muted">read-only</Pill>}
          {user.disabled && <Pill tone="danger">disabled</Pill>}
        </div>
        <div className="flex items-center gap-1">
          <ConnBadge label="Jira" on={user.connections.jira} />
          <ConnBadge label="GitHub" on={user.connections.github} />
          <ConnBadge label="AI" on={user.connections.ai} />
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onToggleExpand}>
            <Settings2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            {expanded ? "Close" : "Manage"}
          </Button>
          <Button
            type="button"
            variant={isAdmin ? "outline" : "default"}
            size="sm"
            disabled={busy || user.bootstrapAdmin}
            title={user.bootstrapAdmin ? "Admin via ADMIN_EMAILS — can't be demoted here" : undefined}
            onClick={() => onToggleRole(user)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
            {isAdmin ? "Make user" : "Make admin"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 bg-muted/30 space-y-5">
          {/* Access & credentials */}
          <section>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Access & credentials
            </p>
            <AccessForm user={user} sources={sources} busy={busy}
              onSave={(input) => onSaveAccess(user.id, input)} />
          </section>

          {/* Password */}
          <section>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Reset password
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); onSetPassword(user.id, password); setPassword(""); }}
              className="flex flex-wrap items-end gap-2"
            >
              <div className="min-w-[220px]">
                <Label htmlFor={`pw-${user.id}`} className="text-xs font-medium">New password</Label>
                <Input id={`pw-${user.id}`} type="password" minLength={8} required autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Set password</Button>
            </form>
          </section>

          {/* Per-user config */}
          <section>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Board & env overrides
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Blank fields fall back to {user.sharedFrom ? "the shared user's overrides, then " : ""}the global defaults.
            </p>
            <TemplatePicker
              templates={templates}
              busy={busy}
              id={user.id}
              scope={user.email}
              onApply={(templateId, merge) => onApplyTemplate(user.id, templateId, merge)}
            />
            <ConfigForm
              key={`${user.id}-${formEpoch}`} // remount so applied template values show up
              idPrefix={`u-${user.id}`}
              initial={user.config}
              saving={busy}
              submitLabel="Save user config"
              onSave={(cfg) => onSaveConfig(user.id, cfg)}
            />
          </section>

          {/* Danger zone */}
          <section>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Danger zone
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || user.bootstrapAdmin}
                title={user.bootstrapAdmin ? "Admin via ADMIN_EMAILS — can't be disabled here" : undefined}
                onClick={() => onToggleDisabled(user)}>
                {user.disabled
                  ? <><Undo2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Enable</>
                  : <><Ban className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Disable</>}
              </Button>
              {confirmingDelete ? (
                <>
                  <Button type="button" size="sm" variant="destructive" disabled={busy}
                    onClick={() => onDelete(user)}>
                    Confirm delete
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onRequestDelete(null)}>Cancel</Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={busy || user.bootstrapAdmin}
                  title={user.bootstrapAdmin ? "Admin via ADMIN_EMAILS — can't be deleted here" : undefined}
                  onClick={() => onRequestDelete(user)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Delete
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Admin() {
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Bumped whenever a template is applied, to remount the config forms with the new values.
  const [formEpoch, setFormEpoch] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [users, tpl] = await Promise.all([getAdminUsers(), getTemplates()]);
      setData(users);
      setTemplates(tpl.templates);
    } catch (err) { setError(errMsg(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function replaceUser(u: AdminUser) {
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? u : x)) } : d));
  }

  async function withUser<T>(userId: string, fn: () => Promise<T>, ok?: string): Promise<void> {
    setBusyUserId(userId); setError(null); setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (err) { setError(errMsg(err)); }
    finally { setBusyUserId(null); }
  }

  async function onCreate(input: Parameters<typeof createUser>[0]) {
    setCreating(true); setError(null); setNotice(null);
    try {
      const u = await createUser(input);
      setData((d) => (d ? { ...d, users: [...d.users, u] } : d));
      setNotice(`Created ${u.email}${u.sharedFrom ? ` (shares credentials from ${u.sharedFrom})` : ""}.`);
    } catch (err) { setError(errMsg(err)); }
    finally { setCreating(false); }
  }

  const saveGlobal = async (cfg: AdminConfig) => {
    setSavingGlobal(true); setError(null); setNotice(null);
    try {
      const r = await putGlobalConfig(cfg);
      setData((d) => (d ? { ...d, globalConfig: r.globalConfig } : d));
      setNotice("Global defaults saved.");
    } catch (err) { setError(errMsg(err)); }
    finally { setSavingGlobal(false); }
  };

  const saveUserConfig = (userId: string, cfg: AdminConfig) =>
    withUser(userId, async () => { replaceUser(await putUserConfig(userId, cfg)); setExpandedId(null); }, "User config saved.");

  const saveAccess = (userId: string, input: { credentialSourceUserId: string | null; allowWrites: boolean }) =>
    withUser(userId, async () => { replaceUser(await updateUser(userId, input)); }, "Access updated.");

  const setPassword = (userId: string, password: string) =>
    withUser(userId, async () => { replaceUser(await updateUser(userId, { password })); }, "Password updated.");

  const toggleDisabled = (u: AdminUser) =>
    withUser(u.id, async () => { replaceUser(await updateUser(u.id, { disabled: !u.disabled })); },
      u.disabled ? "Account enabled." : "Account disabled.");

  const toggleRole = (u: AdminUser) =>
    withUser(u.id, async () => { replaceUser(await putUserRole(u.id, u.role === "admin" ? "user" : "admin")); });

  const removeUser = (u: AdminUser) =>
    withUser(u.id, async () => {
      await deleteUser(u.id);
      setData((d) => (d ? { ...d, users: d.users.filter((x) => x.id !== u.id) } : d));
      setDeletingId(null);
      setExpandedId(null);
    }, `Deleted ${u.email}.`);

  // ── Templates (v1.47, ADR-057) ──────────────────────────────────────────────

  async function onCreateTemplate(name: string, config: AdminConfig) {
    setCreatingTemplate(true); setError(null); setNotice(null);
    try {
      const tpl = await createTemplate(name, config);
      setTemplates((ts) => [...ts, tpl].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(`Template "${tpl.name}" created.`);
    } catch (err) { setError(errMsg(err)); }
    finally { setCreatingTemplate(false); }
  }

  async function onDeleteTemplate(t: ConfigTemplate) {
    setBusyTemplateId(t.id); setError(null); setNotice(null);
    try {
      await deleteTemplate(t.id);
      setTemplates((ts) => ts.filter((x) => x.id !== t.id));
      setNotice(`Template "${t.name}" deleted.`);
    } catch (err) { setError(errMsg(err)); }
    finally { setBusyTemplateId(null); }
  }

  const applyToUser = (userId: string, templateId: string, merge: boolean) =>
    withUser(userId, async () => {
      replaceUser(await applyTemplateToUser(userId, templateId, merge));
      setFormEpoch((n) => n + 1);
    }, merge ? "Template merged into the user's config." : "Template applied to the user's config.");

  async function applyToGlobal(templateId: string, merge: boolean) {
    setSavingGlobal(true); setError(null); setNotice(null);
    try {
      const r = await applyTemplateToGlobal(templateId, merge);
      setData((d) => (d ? { ...d, globalConfig: r.globalConfig } : d));
      setFormEpoch((n) => n + 1);
      setNotice(merge ? "Template merged into the global defaults." : "Template applied to the global defaults.");
    } catch (err) { setError(errMsg(err)); }
    finally { setSavingGlobal(false); }
  }

  // Users who can lend credentials: they own a Jira connection and borrow from nobody.
  const sources = (data?.users ?? []).filter((u) => u.canBeSource);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-bold text-foreground">Admin console</h1>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} aria-hidden="true" /> Refresh
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-success flex items-center gap-1.5" role="status">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" /> {notice}
        </p>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading users…
        </div>
      ) : (
        <>
          <AddUserCard sources={sources} busy={creating} onCreate={onCreate} />

          <TemplatesCard
            templates={templates}
            busy={busyTemplateId}
            creating={creatingTemplate}
            onCreate={(name, cfg) => void onCreateTemplate(name, cfg)}
            onDelete={(t) => void onDeleteTemplate(t)}
          />

          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-foreground">
                Users {data ? <span className="text-muted-foreground font-normal">({data.users.length})</span> : null}
              </h2>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {data && data.users.length > 0 ? (
                data.users.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    sources={sources}
                    templates={templates}
                    formEpoch={formEpoch}
                    busy={busyUserId === u.id}
                    expanded={expandedId === u.id}
                    confirmingDelete={deletingId === u.id}
                    onToggleRole={toggleRole}
                    onToggleExpand={() => setExpandedId((cur) => (cur === u.id ? null : u.id))}
                    onSaveConfig={saveUserConfig}
                    onSaveAccess={saveAccess}
                    onSetPassword={setPassword}
                    onToggleDisabled={toggleDisabled}
                    onDelete={removeUser}
                    onRequestDelete={(target) => setDeletingId(target ? target.id : null)}
                    onApplyTemplate={applyToUser}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-2">No users yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-foreground">Global defaults</h2>
              <p className="text-xs text-muted-foreground">
                Applied to every user; a user's own connection and per-user overrides win. Tokens are never set here.
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <TemplatePicker
                templates={templates}
                busy={savingGlobal}
                id="global"
                scope="global defaults"
                onApply={(templateId, merge) => void applyToGlobal(templateId, merge)}
              />
              <ConfigForm
                key={`global-${formEpoch}`} // remount so applied template values show up
                idPrefix="cfg"
                initial={data?.globalConfig ?? {}}
                saving={savingGlobal}
                submitLabel="Save global defaults"
                onSave={saveGlobal}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
