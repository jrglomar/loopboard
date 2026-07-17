import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateSprintDialog } from "./CreateSprintDialog";

// ── Mock hooks/useJira so we can control createSprint ─────────────────────────

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    createSprint: vi.fn(),
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_SPRINT = {
  id: 77,
  name: "Sprint 8",
  state: "future" as const,
  startDate: "2026-06-15T00:00:00.000Z",
  endDate: "2026-06-28T00:00:00.000Z",
  completeDate: null,
  goal: "Planning ahead",
  boardId: 1,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CreateSprintDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the 'New Sprint' trigger button", () => {
    render(<CreateSprintDialog onSuccess={() => undefined} />);
    expect(screen.getByRole("button", { name: /new sprint/i })).toBeTruthy();
  });

  it("opens dialog when trigger button is clicked", async () => {
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      // Dialog title heading
      expect(screen.getByRole("heading", { name: /create sprint/i })).toBeTruthy();
    });
  });

  it("shows a warning that this creates a REAL sprint on Jira", async () => {
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));

    await waitFor(() => {
      expect(screen.getByText(/real future sprint/i)).toBeTruthy();
    });
  });

  it("has labeled fields: name, goal, start date, end date", async () => {
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));

    await waitFor(() => {
      // a11y: each field has a label
      expect(screen.getByLabelText(/sprint name/i)).toBeTruthy();
      expect(screen.getByLabelText(/sprint goal/i)).toBeTruthy();
      expect(screen.getByLabelText(/start date/i)).toBeTruthy();
      expect(screen.getByLabelText(/end date/i)).toBeTruthy();
    });
  });

  it("blocks submit when name is empty and shows inline error", async () => {
    const { createSprint } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    // Click Create Sprint without filling name
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/sprint name is required/i)).toBeTruthy();
    });
    // createSprint must NOT have been called
    expect(vi.mocked(createSprint)).not.toHaveBeenCalled();
  });

  it("shows validation error when start date >= end date", async () => {
    const { createSprint } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint X");

    // Set start = end (invalid: start must be < end)
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-07-01" } });

    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/start date must be before end date/i)).toBeTruthy();
    });
    expect(vi.mocked(createSprint)).not.toHaveBeenCalled();
  });

  it("calls create_sprint with the correct body on valid submission", async () => {
    const { createSprint } = await import("../hooks/useJira");
    vi.mocked(createSprint).mockResolvedValueOnce(MOCK_SPRINT);

    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint 8");
    await user.type(screen.getByLabelText(/sprint goal/i), "Plan the future");
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-07-14" } });

    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(vi.mocked(createSprint)).toHaveBeenCalledOnce();
      expect(vi.mocked(createSprint)).toHaveBeenCalledWith({
        name: "Sprint 8",
        goal: "Plan the future",
        startDate: "2026-07-01",
        endDate: "2026-07-14",
      });
    });
  });

  it("calls create_sprint with only required name when optional fields omitted", async () => {
    const { createSprint } = await import("../hooks/useJira");
    vi.mocked(createSprint).mockResolvedValueOnce(MOCK_SPRINT);

    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint 8");
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(vi.mocked(createSprint)).toHaveBeenCalledOnce();
      expect(vi.mocked(createSprint)).toHaveBeenCalledWith({ name: "Sprint 8" });
    });
  });

  it("closes dialog and calls onSuccess with new sprint on success", async () => {
    const { createSprint } = await import("../hooks/useJira");
    vi.mocked(createSprint).mockResolvedValueOnce(MOCK_SPRINT);

    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint 8");
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(onSuccess).toHaveBeenCalledWith(MOCK_SPRINT);
    });
    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows inline server error when create_sprint throws UPSTREAM error", async () => {
    const { createSprint } = await import("../hooks/useJira");
    vi.mocked(createSprint).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Jira returned 400 — board not found",
    });

    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint Bad");
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/Jira returned 400/i)).toBeTruthy();
    });
    // Dialog stays open
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows inline validation error for VALIDATION server error", async () => {
    const { createSprint } = await import("../hooks/useJira");
    vi.mocked(createSprint).mockRejectedValueOnce({
      code: "VALIDATION",
      message: "name must be 1–255 characters",
    });

    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "X");
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      expect(screen.getByText(/name must be 1–255 characters/i)).toBeTruthy();
    });
  });

  it("disables submit button while submitting", async () => {
    const { createSprint } = await import("../hooks/useJira");
    // Never resolves during the test — keeps the button in "submitting" state
    vi.mocked(createSprint).mockImplementationOnce(
      () => new Promise(() => undefined)
    );

    const user = userEvent.setup();
    render(<CreateSprintDialog onSuccess={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    await waitFor(() => screen.getByRole("dialog"));

    await user.type(screen.getByLabelText(/sprint name/i), "Sprint 8");
    await user.click(screen.getByRole("button", { name: /^create sprint$/i }));

    await waitFor(() => {
      // Button text changes to "Creating…" and it is disabled
      expect(screen.getByRole("button", { name: /creating/i })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /creating/i }).hasAttribute("disabled")).toBe(true);
  });
});
