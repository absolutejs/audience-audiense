import { describe, expect, test } from "bun:test";
import { audienseSource, type AudienseConfig } from "../src/index";

// Route a stub fetch by "METHOD path" and record calls, so we can assert the
// auth flow + token caching + endpoint mapping with no network or credentials.
const stubFetch = (routes: Record<string, unknown>) => {
  const calls: { auth?: string; url: string }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const path = href.replace("https://api.audiense.com/v1", "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ auth: headers.get("Authorization") ?? undefined, url: `${method} ${path}` });
    const body = routes[`${method} ${path}`];
    if (body === undefined) return new Response("not found", { status: 404 });

    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
};

const baseConfig = (fetchImpl: typeof fetch): AudienseConfig => ({
  clientId: "cid",
  clientSecret: "csec",
  defaultBaselineId: "base1",
  fetch: fetchImpl,
  now: () => 1000,
});

const TOKEN = { access_token: "tok", expires_in: 3600 };

describe("auth", () => {
  test("POSTs client_credentials with Basic auth and caches the token", async () => {
    const { calls, fetchImpl } = stubFetch({
      "GET /reports/intelligence": { reports: [] },
      "POST /login/token": TOKEN,
    });
    const src = audienseSource(baseConfig(fetchImpl));

    await src.listAudiences?.();
    await src.listAudiences?.();

    const tokenCalls = calls.filter((c) => c.url === "POST /login/token");
    expect(tokenCalls.length).toBe(1); // cached across both list calls
    expect(tokenCalls[0]?.auth).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
    // Subsequent calls carry the bearer token.
    expect(calls.find((c) => c.url === "GET /reports/intelligence")?.auth).toBe("Bearer tok");
  });
});

describe("listAudiences", () => {
  test("maps reports to audience refs", async () => {
    const { fetchImpl } = stubFetch({
      "GET /reports/intelligence": {
        reports: [{ audienceSize: 1000, id: "r1", status: "ready", title: "Acme audience" }],
      },
      "POST /login/token": TOKEN,
    });
    const refs = await audienseSource(baseConfig(fetchImpl)).listAudiences?.();
    expect(refs?.[0]).toEqual({
      id: "r1",
      meta: { size: 1000, status: "ready" },
      name: "Acme audience",
    });
  });
});

describe("getAudience", () => {
  test("assembles size, demographics (0-1), and influencer affinities", async () => {
    const { fetchImpl } = stubFetch({
      "GET /audience_influencers/inf1/compared_to/base1": {
        influencers: [
          { affinity: 80, baselineAffinity: 10, name: "@x", uniqueness: 8, userId: "u1" },
        ],
      },
      "GET /audience_insights/i1": {
        insights: [
          { name: "Gender", values: [{ name: "male", percentage: 60 }, { name: "female", percentage: 40 }] },
        ],
      },
      "GET /reports/intelligence/r1": {
        audienceSize: 1000,
        audience_influencers_id: "inf1",
        audience_insights_id: "i1",
        id: "r1",
        segments: [{ id: "s1", name: "Cluster A" }],
        title: "Acme audience",
      },
      "POST /login/token": TOKEN,
    });
    const profile = await audienseSource(baseConfig(fetchImpl)).getAudience?.("r1");
    expect(profile?.size).toBe(1000);
    expect(profile?.demographics?.Gender).toEqual([
      { label: "male", share: 0.6 },
      { label: "female", share: 0.4 },
    ]);
    expect(profile?.affinities?.[0]).toMatchObject({
      affinity: 0.8,
      baselineAffinity: 0.1,
      id: "u1",
      kind: "influencer",
      name: "@x",
    });
    expect(profile?.segments?.[0]?.name).toBe("Cluster A");
  });
});

describe("overlap", () => {
  test("composes shared-affinity overlap from two audiences", async () => {
    const { fetchImpl } = stubFetch({
      "GET /audience_influencers/infA/compared_to/base1": {
        influencers: [{ affinity: 90, name: "@shared", userId: "u1" }, { affinity: 50, name: "@a", userId: "u2" }],
      },
      "GET /audience_influencers/infB/compared_to/base1": {
        influencers: [{ affinity: 85, name: "@shared", userId: "u1" }, { affinity: 60, name: "@b", userId: "u3" }],
      },
      "POST /login/token": TOKEN,
    });
    const src = audienseSource(baseConfig(fetchImpl));
    // Pass influencersId via meta so affinities() skips the report lookup.
    const a = { id: "rA", meta: { influencersId: "infA" } };
    const b = { id: "rB", meta: { influencersId: "infB" } };
    const result = await src.overlap?.(a, b);
    expect(result?.method).toBe("shared-affinity");
    expect(result?.score).toBeGreaterThan(0);
    expect(result?.sharedAffinities.map((s) => s.name)).toEqual(["@shared"]);
  });
});
