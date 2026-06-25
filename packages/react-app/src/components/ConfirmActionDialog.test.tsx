// ConfirmActionDialog tests — v1.19, ADR-030. Keyless/offline (callTool mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import type { ProposedAction } from "../lib/types";

vi.mock("../lib/mcpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mcpClient")>();
  return { ...actual, callTool: vi.fn().mockResolvedValue({ key: "VRDB-2700" }) };
});
import * as mcp from "../lib/mcpClient";

const noop = () => undefined;
const updateAction: ProposedAction = { tool: "update_ticket", args: { ticketKey: "VRDB-2700", storyPoints: 2 } };

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("ConfirmActionDialog (v1.19)", () => {
  it("executes the write via callTool on Confirm", async () => {
    const onResult = vi.fn();
    render(<ConfirmActionDialog action={updateAction} open onOpenChange={noop} onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() =>
      expect(vi.mocked(mcp.callTool)).toHaveBeenCalledWith("jira", "update_ticket", {
        ticketKey: "VRDB-2700",
        storyPoints: 2,
      })
    );
    await waitFor(() => expect(onResult).toHaveBeenCalled());
  });

  it("does NOT execute on Cancel", () => {
    render(<ConfirmActionDialog action={updateAction} open onOpenChange={noop} onResult={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(vi.mocked(mcp.callTool)).not.toHaveBeenCalled();
  });

  it("renders an editable form for create_sprint", () => {
    render(
      <ConfirmActionDialog
        action={{ tool: "create_sprint", args: { name: "Sprint X", boardId: 10 } }}
        open
        onOpenChange={noop}
        onResult={noop}
      />
    );
    expect((screen.getByLabelText(/Sprint name/i) as HTMLInputElement).value).toBe("Sprint X");
  });
});
