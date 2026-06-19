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
