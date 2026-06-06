import { describe, expect, it, vi } from "vitest";
import { PlatformClient } from "../src/platform/client.js";

describe("PlatformClient", () => {
  it("logs in and lists projects with bearer auth", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ accessToken: "jwt", tokenType: "bearer" }),
      )
      .mockResolvedValueOnce(response([{ id: "p1", name: "Camera" }]));
    const client = new PlatformClient("https://app.honch.io", fetcher);

    const token = await client.login({
      email: "user@example.com",
      password: "password",
    });
    const projects = await client.listProjects(token.accessToken, "org1");

    expect(projects).toEqual([{ id: "p1", name: "Camera" }]);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://app.honch.io/api/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jwt",
          "X-Organization-Id": "org1",
        }),
      }),
    );
  });
});

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
