// Admin console page — v1.45/v1.46, ADR-055/056. Keyless/offline (adminClient mocked).
// Covers: user list, role toggle, bootstrap-admin lock, global + per-user config,
// and v1.46 user CRUD: create (incl. shared credentials), access changes, disable, delete.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Admin } from "./Admin";

vi.mock("../lib/adminClient", () => ({
  getAdminUsers: vi.fn(),
  putGlobalConfig: vi.fn(),
  putUserConfig: vi.fn(),
  putUserRole: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getTemplates: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  applyTemplateToUser: vi.fn(),
  applyTemplateToGlobal: vi.fn(),
}));

import * as adminClient from "../lib/adminClient";

const api = adminClient as unknown as Record<
  | "getAdminUsers" | "putGlobalConfig" | "putUserConfig" | "putUserRole"
  | "createUser" | "updateUser" | "deleteUser"
  | "getTemplates" | "createTemplate" | "deleteTemplate" | "applyTemplateToUser" | "applyTemplateToGlobal",
  ReturnType<typeof vi.fn>
>;

const TEMPLATE = {
  id: "t1", name: "Team A — Dev",
  config: { JIRA_DEV_BOARD_ID: "1038", JIRA_VELOCITY_SPRINTS: 6 },
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

const boss = {
  id: "u1", email: "boss@team.com", role: "admin" as const, bootstrapAdmin: true,
  createdAt: "2026-01-01T00:00:00Z", connections: { jira: true, github: true, ai: false }, config: {},
  credentialSourceUserId: null, sharedFrom: null, allowWrites: false, disabled: false,
  readOnly: false, canBeSource: true,
};
const dev = {
  id: "u2", email: "dev@team.com", role: "user" as const, bootstrapAdmin: false,
  createdAt: "2026-01-02T00:00:00Z", connections: { jira: false, github: false, ai: false },
  config: { JIRA_PO_BOARD_ID: "999" },
  credentialSourceUserId: null, sharedFrom: null, allowWrites: false, disabled: false,
  readOnly: false, canBeSource: false,
};
const viewer = {
  id: "u3", email: "viewer@team.com", role: "user" as const, bootstrapAdmin: false,
  createdAt: "2026-01-03T00:00:00Z", connections: { jira: false, github: false, ai: false }, config: {},
  credentialSourceUserId: "u1", sharedFrom: "boss@team.com", allowWrites: false, disabled: false,
  readOnly: true, canBeSource: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getAdminUsers.mockResolvedValue({ users: [boss, dev], globalConfig: { JIRA_DEV_BOARD_ID: "10002" } });
  api.putGlobalConfig.mockResolvedValue({ globalConfig: { JIRA_DEV_BOARD_ID: "10002" } });
  api.putUserRole.mockImplementation((id: string, role: "admin" | "user") =>
    Promise.resolve({ ...(id === "u1" ? boss : dev), role })
  );
  api.putUserConfig.mockImplementation((_id: string, config: unknown) => Promise.resolve({ ...dev, config }));
  api.createUser.mockResolvedValue(viewer);
  api.updateUser.mockImplementation((id: string, patch: Record<string, unknown>) =>
    Promise.resolve({ ...dev, id, ...patch })
  );
  api.deleteUser.mockResolvedValue({ deleted: true, id: "u2" });
  api.getTemplates.mockResolvedValue({ templates: [] });
  api.createTemplate.mockResolvedValue(TEMPLATE);
  api.deleteTemplate.mockResolvedValue({ deleted: true });
  api.applyTemplateToUser.mockImplementation((id: string) => Promise.resolve({ ...dev, id, config: TEMPLATE.config }));
  api.applyTemplateToGlobal.mockResolvedValue({ globalConfig: TEMPLATE.config });
});
afterEach(() => cleanup());

/** Open a user's "Manage" panel by row index (0 = boss, 1 = dev). */
function openManage(index: number) {
  fireEvent.click(screen.getAllByRole("button", { name: /^manage$/i })[index]!);
}

describe("Admin console (v1.45)", () => {
  it("lists users with their roles", async () => {
    render(<Admin />);
    await waitFor(() => expect(screen.getByText("boss@team.com")).toBeTruthy());
    expect(screen.getByText("dev@team.com")).toBeTruthy();
  });

  it("locks the role toggle for a bootstrap (ADMIN_EMAILS) admin", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("boss@team.com"));
    const makeUser = screen.getByRole("button", { name: /make user/i });
    expect(makeUser.hasAttribute("disabled")).toBe(true);
  });

  it("promotes a regular user to admin", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    fireEvent.click(screen.getByRole("button", { name: /make admin/i }));
    await waitFor(() => expect(api.putUserRole).toHaveBeenCalledWith("u2", "admin"));
  });

  it("saves global defaults with numeric fields coerced", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("boss@team.com"));
    fireEvent.change(screen.getByLabelText("Velocity sprints"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save global defaults/i }));
    await waitFor(() =>
      expect(api.putGlobalConfig).toHaveBeenCalledWith({ JIRA_DEV_BOARD_ID: "10002", JIRA_VELOCITY_SPRINTS: 4 })
    );
  });

  it("edits a user's per-user config override", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    openManage(1);
    await waitFor(() => screen.getByRole("button", { name: /save user config/i }));
    fireEvent.click(screen.getByRole("button", { name: /save user config/i }));
    await waitFor(() => expect(api.putUserConfig).toHaveBeenCalledWith("u2", { JIRA_PO_BOARD_ID: "999" }));
  });
});

describe("Admin user CRUD + shared credentials (v1.46)", () => {
  it("creates a user that shares credentials from an eligible source", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("boss@team.com"));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "viewer@team.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "password123" } });
    // Only boss can lend (canBeSource); dev cannot.
    fireEvent.change(screen.getByLabelText("Credentials"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() =>
      expect(api.createUser).toHaveBeenCalledWith({
        email: "viewer@team.com",
        password: "password123",
        role: "user",
        credentialSourceUserId: "u1",
        allowWrites: false,
      })
    );
    // the new shared user appears with its provenance
    await waitFor(() => expect(screen.getByText(/shared from boss@team.com/i)).toBeTruthy());
  });

  it("only offers credential sources that own a Jira connection", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("boss@team.com"));
    const select = screen.getByLabelText("Credentials") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "u1"]); // dev (u2) has no Jira → not lendable
  });

  it("shows the read-only badge for a shared-credential user", async () => {
    api.getAdminUsers.mockResolvedValue({ users: [boss, viewer], globalConfig: {} });
    render(<Admin />);
    await waitFor(() => screen.getByText("viewer@team.com"));
    expect(screen.getByText("read-only")).toBeTruthy();
  });

  it("grants Jira writes to a shared-credential user", async () => {
    api.getAdminUsers.mockResolvedValue({ users: [boss, viewer], globalConfig: {} });
    render(<Admin />);
    await waitFor(() => screen.getByText("viewer@team.com"));
    openManage(1);
    await waitFor(() => screen.getByRole("button", { name: /save access/i }));
    fireEvent.click(screen.getByLabelText(/allow jira changes/i));
    fireEvent.click(screen.getByRole("button", { name: /save access/i }));
    await waitFor(() =>
      expect(api.updateUser).toHaveBeenCalledWith("u3", { credentialSourceUserId: "u1", allowWrites: true })
    );
  });

  it("disables an account", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    openManage(1);
    await waitFor(() => screen.getByRole("button", { name: /^disable$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("u2", { disabled: true }));
  });

  it("requires a confirmation click before deleting", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    openManage(1);
    await waitFor(() => screen.getByRole("button", { name: /^delete$/i }));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(api.deleteUser).not.toHaveBeenCalled(); // first click only arms the confirm

    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith("u2"));
    await waitFor(() => expect(screen.queryByText("dev@team.com")).toBeNull()); // removed from the list
  });

  it("resets a user's password", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    openManage(1);
    await waitFor(() => screen.getByLabelText("New password"));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "brand-new-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("u2", { password: "brand-new-pass" }));
  });
});

describe("Admin config templates (v1.47)", () => {
  it("shows an empty state and hides the template picker when there are none", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("No templates yet."));
    expect(screen.queryByLabelText("Apply a template")).toBeNull();
  });

  it("creates a template from a name + config", async () => {
    render(<Admin />);
    await waitFor(() => screen.getByText("No templates yet."));

    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Team A — Dev" } });
    // The template form has its own id prefix, so its fields are addressable alongside the global form.
    fireEvent.change(document.getElementById("tpl-JIRA_DEV_BOARD_ID") as HTMLInputElement, { target: { value: "1038" } });
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledWith("Team A — Dev", { JIRA_DEV_BOARD_ID: "1038" }));
    await waitFor(() => expect(screen.getByText("Team A — Dev")).toBeTruthy());
  });

  it("lists a template with its field count and deletes it after confirmation", async () => {
    api.getTemplates.mockResolvedValue({ templates: [TEMPLATE] });
    render(<Admin />);
    await waitFor(() => screen.getByText("Team A — Dev"));
    expect(screen.getByText("2 fields")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /delete template team a/i }));
    expect(api.deleteTemplate).not.toHaveBeenCalled(); // first click arms the confirm
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(api.deleteTemplate).toHaveBeenCalledWith("t1"));
  });

  it("applies a template to the global defaults (replace and merge)", async () => {
    api.getTemplates.mockResolvedValue({ templates: [TEMPLATE] });
    render(<Admin />);
    await waitFor(() => screen.getByText("Team A — Dev"));

    fireEvent.change(screen.getByLabelText("Apply a template"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /replace global defaults config/i }));
    await waitFor(() => expect(api.applyTemplateToGlobal).toHaveBeenCalledWith("t1", false));

    fireEvent.click(screen.getByRole("button", { name: /merge the selected template on top of global defaults/i }));
    await waitFor(() => expect(api.applyTemplateToGlobal).toHaveBeenCalledWith("t1", true));
  });

  it("applies a template to one user's overrides, not the global defaults", async () => {
    api.getTemplates.mockResolvedValue({ templates: [TEMPLATE] });
    render(<Admin />);
    await waitFor(() => screen.getByText("dev@team.com"));
    openManage(1);

    // Two pickers coexist (this user's + global); each names the scope it changes.
    const userPicker = await waitFor(() => document.getElementById("tpl-pick-u2") as HTMLSelectElement);
    fireEvent.change(userPicker, { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /replace dev@team\.com config/i }));

    await waitFor(() => expect(api.applyTemplateToUser).toHaveBeenCalledWith("u2", "t1", false));
    expect(api.applyTemplateToGlobal).not.toHaveBeenCalled();
  });
});
