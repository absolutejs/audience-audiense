// Audiense Insights API response shapes, modeled from Audiense's own official
// client (github.com/audienseco/mcp-audiense-insights). The public client did not
// expose every field name, so shapes here are TOLERANT (fields optional, common
// aliases accepted). Confirm exact field names against the live API — or against
// the feed your Audiense data partnership grants — before relying on a field; the
// mappers in index.ts degrade gracefully when a field is absent.

export type AudienseToken = {
  access_token: string;
  expires_in: number;
};

export type AudienseReport = {
  audienceSize?: number;
  id: string;
  name?: string;
  segmentationType?: string;
  status?: string;
  title?: string;
};

export type IntelligenceReportsResponse =
  | { reports?: AudienseReport[] }
  | AudienseReport[];

export type AudienseSegment = {
  audience_content_id?: string;
  audience_influencers_id?: string;
  audience_insights_id?: string;
  id: string;
  name?: string;
  size?: number;
};

export type ReportInfoResponse = AudienseReport & {
  audience_influencers_id?: string;
  audience_insights_id?: string;
  baseline_id?: string;
  segments?: AudienseSegment[];
};

export type AudienseInsightValue = {
  label?: string;
  name?: string;
  percentage?: number;
  value?: number;
};

export type AudienseInsightEntry = {
  name: string;
  values?: AudienseInsightValue[];
};

export type AudienceInsightsResponse = {
  insights?: AudienseInsightEntry[];
};

export type AudienseInfluencer = {
  affinity?: number; // percentage, 0–100
  baselineAffinity?: number; // percentage, 0–100
  id?: string;
  name?: string;
  screenName?: string;
  uniqueness?: number;
  userId?: string;
};

export type InfluencersComparisonResponse = {
  cursor?: string;
  influencers?: AudienseInfluencer[];
};
