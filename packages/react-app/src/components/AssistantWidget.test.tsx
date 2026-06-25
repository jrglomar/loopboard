// AssistantWidget tests — v1.19, ADR-030. Keyless/offline (ChatPanel + data hooks mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AssistantWidget } from "./AssistantWidget";

vi.mock("./ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">Chat Panel</div>,
}));
vi.mock("../lib/aiClient", () => ({
  getAiStatus: vi.fn().mockResolvedValue({ enabled: false, provider: null, model: null }),
}));
vi.mock("../lib/boards", () => ({
  useBoards: vi.fn().mockReturnValue({ boards: null, loading: false }),
}));
vi.mock("../hooks/useJira", () => ({
  useActiveSprint: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("AssistantWidget (v1.19)", () => {
  it("shows a closed FAB and no panel initially", () => {
    render(<AssistantWidget />);
    expect(screen.getByRole("button", { name: /open sprint assistant/i })).toBeTruthy();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("opens the assistant panel on FAB click", () => {
    render(<AssistantWidget />);
    fireEvent.click(screen.getByRole("button", { name: /open sprint assistant/i }));
    expect(screen.getByTestId("chat-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /close sprint assistant/i })).toBeTruthy();
  });

  it("hides (but keeps mounted) the panel on a second click", () => {
    render(<AssistantWidget />);
    const fab = () => screen.getByRole("button", { name: /sprint assistant/i });
    fireEvent.click(fab()); // open
    fireEvent.click(fab()); // close
    // FAB back to "open"; panel still mounted (history persists) but its wrapper is hidden
    expect(screen.getByRole("button", { name: /open sprint assistant/i })).toBeTruthy();
    const panel = screen.getByRole("dialog", { name: /sprint assistant/i });
    expect(panel.className).toContain("hidden");
  });
});
