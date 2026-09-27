import { affinityItemsOverlap } from "@absolutejs/audience";
import type {
  AffinityItem,
  AudienceOverlapResult,
  AudienceProfile,
  AudienceRef,
  AudienceSource,
  DemographicBucket,
} from "@absolutejs/audience";
import type {
  AudienceInsightsResponse,
  AudienseInfluencer,
  AudienseReport,
  AudienseSegment,
  AudienseToken,
  InfluencersComparisonResponse,
  IntelligenceReportsResponse,
  ReportInfoResponse,
} from "./types";

const DEFAULT_BASE_URL = "https://api.audiense.com/v1";
// Refresh a little before the token actually expires to avoid edge-of-expiry 401s.
const TOKEN_SKEW_MS = 60_000;
const PERCENT = 100;

export type AudienseConfig = {
  /** Audiense API base URL. Defaults to https://api.audiense.com/v1. */
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  /** Baseline report/audience id to compare influencer affinities against. Can
   *  be overridden per call via a ref's `meta.baselineId`. */
  defaultBaselineId?: string;
  /** Inject a fetch implementation (tests, custom runtimes). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Inject a clock (tests). Defaults to Date.now. */
  now?: () => number;
};

const refId = (ref: AudienceRef | string) =>
  typeof ref === "string" ? ref : ref.id;

const refMeta = (ref: AudienceRef | string) =>
  typeof ref === "string" ? undefined : ref.meta;

const base64 = (value: string) => Buffer.from(value).toString("base64");

const reportName = (report: AudienseReport) =>
  report.title ?? report.name ?? report.id;

// Audiense affinities/percentages are 0–100; the AudienceSource contract is 0–1.
const fromPercent = (value: number | undefined) =>
  typeof value === "number" ? value / PERCENT : undefined;

const reportsArray = (data: IntelligenceReportsResponse): AudienseReport[] =>
  Array.isArray(data) ? data : (data.reports ?? []);

const toAffinity = (influencer: AudienseInfluencer): AffinityItem => ({
  affinity: fromPercent(influencer.affinity) ?? 0,
  baselineAffinity: fromPercent(influencer.baselineAffinity),
  id: influencer.userId ?? influencer.id,
  kind: "influencer",
  name:
    influencer.name ??
    influencer.screenName ??
    influencer.userId ??
    influencer.id ??
    "unknown",
  uniqueness: influencer.uniqueness,
});

const toDemographics = (
  data: AudienceInsightsResponse,
): Record<string, DemographicBucket[]> => {
  const out: Record<string, DemographicBucket[]> = {};
  for (const entry of data.insights ?? []) {
    const buckets = (entry.values ?? [])
      .map((value) => ({
        label: value.name ?? value.label ?? "",
        share: fromPercent(value.percentage) ?? value.value ?? 0,
      }))
      .filter((bucket) => bucket.label);
    if (buckets.length) out[entry.name] = buckets;
  }

  return out;
};

const toSegmentRef = (segment: AudienseSegment): AudienceRef => ({
  id: segment.id,
  meta: {
    contentId: segment.audience_content_id,
    influencersId: segment.audience_influencers_id,
    insightsId: segment.audience_insights_id,
    size: segment.size,
  },
  name: segment.name,
});

/** Construct an Audiense-backed AudienceSource. Implements listAudiences /
 *  getAudience / affinities / overlap against the Audiense Insights API. Overlap
 *  is computed from shared affinities (Audiense exposes no two-audience
 *  intersection endpoint at this tier); swap in a native endpoint here if your
 *  data partnership grants one. */
export const audienseSource = (config: AudienseConfig): AudienceSource => {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = config.fetch ?? fetch;
  const now = config.now ?? Date.now;

  let cached: { expiresAt: number; token: string } | null = null;

  const getToken = async () => {
    if (cached && now() < cached.expiresAt) return cached.token;
    const response = await fetchImpl(`${baseUrl}/login/token`, {
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${base64(`${config.clientId}:${config.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Audiense token request failed: ${response.status}`);
    }
    const token = (await response.json()) as AudienseToken;
    cached = {
      expiresAt: now() + token.expires_in * 1000 - TOKEN_SKEW_MS,
      token: token.access_token,
    };

    return cached.token;
  };

  const apiGet = async <T>(path: string): Promise<T> => {
    const token = await getToken();
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Audiense GET ${path} failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  };

  const listAudiences = async (): Promise<AudienceRef[]> => {
    const data = await apiGet<IntelligenceReportsResponse>(
      "/reports/intelligence",
    );

    return reportsArray(data).map((report) => ({
      id: report.id,
      meta: { size: report.audienceSize, status: report.status },
      name: reportName(report),
    }));
  };

  const baselineFor = (ref: AudienceRef | string) => {
    const meta = refMeta(ref);
    const fromRef = typeof meta?.baselineId === "string" ? meta.baselineId : undefined;

    return fromRef ?? config.defaultBaselineId;
  };

  // Resolve the influencers id for an audience: prefer an explicit one on the
  // ref's meta, else read it off the report.
  const influencersIdFor = async (ref: AudienceRef | string) => {
    const meta = refMeta(ref);
    if (typeof meta?.influencersId === "string") return meta.influencersId;
    const report = await apiGet<ReportInfoResponse>(
      `/reports/intelligence/${refId(ref)}`,
    );

    return (
      report.audience_influencers_id ??
      report.segments?.[0]?.audience_influencers_id
    );
  };

  const affinities = async (
    ref: AudienceRef | string,
  ): Promise<AffinityItem[]> => {
    const influencersId = await influencersIdFor(ref);
    const baselineId = baselineFor(ref);
    if (!influencersId || !baselineId) return [];
    const data = await apiGet<InfluencersComparisonResponse>(
      `/audience_influencers/${influencersId}/compared_to/${baselineId}`,
    );

    return (data.influencers ?? [])
      .map(toAffinity)
      .sort((a, b) => b.affinity - a.affinity);
  };

  const getAudience = async (
    ref: AudienceRef | string,
  ): Promise<AudienceProfile> => {
    const report = await apiGet<ReportInfoResponse>(
      `/reports/intelligence/${refId(ref)}`,
    );
    const insightsId =
      report.audience_insights_id ?? report.segments?.[0]?.audience_insights_id;

    const [demographics, affinityItems] = await Promise.all([
      insightsId
        ? apiGet<AudienceInsightsResponse>(`/audience_insights/${insightsId}`)
            .then(toDemographics)
            .catch(() => ({}))
        : Promise.resolve({}),
      affinities(ref).catch(() => [] as AffinityItem[]),
    ]);

    return {
      affinities: affinityItems,
      demographics,
      ref: {
        id: report.id,
        meta: { status: report.status },
        name: reportName(report),
      },
      segments: (report.segments ?? []).map(toSegmentRef),
      size: report.audienceSize,
    };
  };

  const overlap = async (
    a: AudienceRef | string,
    b: AudienceRef | string,
  ): Promise<AudienceOverlapResult> => {
    const [affinitiesA, affinitiesB] = await Promise.all([
      affinities(a),
      affinities(b),
    ]);

    return affinityItemsOverlap(affinitiesA, affinitiesB);
  };

  return {
    affinities,
    getAudience,
    listAudiences,
    overlap,
    provider: "audiense",
  };
};
