import { describe, expect, it, vi } from "vitest";
import { capturePostHog, posthogConfig } from "../src/posthog.js";

describe("posthogConfig", () => {
  it("returns the baked defaults when no env overrides are set", () => {
    const config = posthogConfig({});
    expect(config.key).toBe("phc_tPWRdoGpDLXkSN5ZkYBTCbtTDki2hWdQKdFLZA9AQUxa");
    expect(config.host).toBe("https://us.i.posthog.com");
  });

  it("honors HONCH_WIZARD_POSTHOG_KEY override", () => {
    const config = posthogConfig({ HONCH_WIZARD_POSTHOG_KEY: "phc_test" });
    expect(config.key).toBe("phc_test");
  });

  it("honors HONCH_WIZARD_POSTHOG_HOST override and strips trailing slash", () => {
    const config = posthogConfig({
      HONCH_WIZARD_POSTHOG_HOST: "https://my.posthog.com/",
    });
    expect(config.host).toBe("https://my.posthog.com");
  });
});

describe("capturePostHog", () => {
  it("posts to ${host}/capture/ with correct shape", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    await capturePostHog(
      {
        event: "wizard_started",
        distinctId: "run-abc",
        properties: { os: "darwin" },
      },
      {
        fetchImpl,
        env: { HONCH_WIZARD_POSTHOG_KEY: "phc_testkey" },
      },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.api_key).toBe("phc_testkey");
    expect(body.event).toBe("wizard_started");
    expect(body.distinct_id).toBe("run-abc");
    expect((body.properties as Record<string, unknown>).os).toBe("darwin");
    expect(
      (body.properties as Record<string, unknown>).$process_person_profile,
    ).toBe(false);
  });

  it("no-ops when the key is empty", async () => {
    const fetchImpl = vi.fn();
    await capturePostHog(
      { event: "wizard_started", distinctId: "run-abc" },
      { fetchImpl, env: { HONCH_WIZARD_POSTHOG_KEY: "" } },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows a rejected fetch without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network failure"));
    await expect(
      capturePostHog(
        { event: "wizard_started", distinctId: "run-abc" },
        {
          fetchImpl,
          env: { HONCH_WIZARD_POSTHOG_KEY: "phc_testkey" },
        },
      ),
    ).resolves.toBeUndefined();
  });
});
