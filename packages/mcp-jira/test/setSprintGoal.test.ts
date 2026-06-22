// set_sprint_goal tool tests — v1.13, ADR-024. Keyless/offline (jiraClient mocked).

import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest";

vi.mock("../src/lib/jiraClient.js", () => ({
  updateSprintGoal: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { setSprintGoalTool } from "../src/tools/setSprintGoal.js";

const client = jiraClient as MockedObject<typeof jiraClient>;

beforeEach(() => vi.clearAllMocks());

describe("set_sprint_goal (v1.13)", () => {
  it("updates the goal and returns { sprintId, goal }", async () => {
    client.updateSprintGoal.mockResolvedValueOnce({ id: 55, goal: "Ship checkout" });

    const result = (await setSprintGoalTool.handler({ sprintId: 55, goal: "Ship checkout" })) as {
      sprintId: number; goal: string | null;
    };

    expect(client.updateSprintGoal).toHaveBeenCalledWith(55, "Ship checkout");
    expect(result).toEqual({ sprintId: 55, goal: "Ship checkout" });
  });

  it("allows an empty goal (clear)", async () => {
    client.updateSprintGoal.mockResolvedValueOnce({ id: 55, goal: null });

    const result = (await setSprintGoalTool.handler({ sprintId: 55, goal: "" })) as {
      goal: string | null;
    };

    expect(client.updateSprintGoal).toHaveBeenCalledWith(55, "");
    expect(result.goal).toBeNull();
  });

  it("rejects invalid input (missing sprintId)", async () => {
    await expect(setSprintGoalTool.handler({ goal: "x" })).rejects.toThrow();
    expect(client.updateSprintGoal).not.toHaveBeenCalled();
  });
});
