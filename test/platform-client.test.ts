import { describe, expect, it, vi } from "vitest";
import { PlatformClient } from "../src/platform/client.js";

describe("PlatformClient", () => {
  it("lists projects with bearer auth and organization scoping", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: "p1", name: "Camera" }]));
    const client = new PlatformClient("https://api.honch.io", fetcher);

    const projects = await client.listProjects("jwt", "org1");

    expect(projects).toEqual([{ id: "p1", name: "Camera" }]);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.honch.io/api/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jwt",
          "X-Organization-Id": "org1",
        }),
      }),
    );
  });

  it("posts opt-in feedback with bearer auth", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}));
    const client = new PlatformClient("https://api.honch.io", fetcher);

    await client.sendFeedback("jwt", {
      target: "esp-idf",
      outcome: "success",
      rating: "up",
    });

    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.honch.io/api/wizard/feedback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt" }),
        body: JSON.stringify({
          target: "esp-idf",
          outcome: "success",
          rating: "up",
        }),
      }),
    );
  });

  it("posts install analytics with bearer auth", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}));
    const client = new PlatformClient("https://api.honch.io", fetcher);

    await client.sendAnalytics("jwt", {
      event: "install",
      wizardVersion: "2.2.0",
      os: "darwin",
      arch: "arm64",
      target: "esp-idf",
      outcome: "success",
      agentRan: true,
      durationMs: 4200,
    });

    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.honch.io/api/wizard/analytics",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt" }),
      }),
    );
  });

  it("includes platform error details when requests fail", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ message: "Project name already taken" }, { status: 409 }),
      );
    const client = new PlatformClient("https://api.honch.io", fetcher);

    await expect(client.createProject("jwt", "Camera")).rejects.toThrow(
      "Platform request failed: HTTP 409 - Project name already taken",
    );
  });
});

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
