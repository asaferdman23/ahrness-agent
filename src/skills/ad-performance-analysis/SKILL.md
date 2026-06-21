---
name: ad-performance-analysis
description: Analyze Meta Ads performance data — diagnose underperforming campaigns, identify winning ad sets, calculate key metrics (ROAS, CPA, CTR, CPM), and deliver clear actionable recommendations.
allowed-tools: get_insights get_ad_account_insights get_campaigns get_ad_sets get_ads sandbox_bash sandbox_file_editor publish_output
---

# Ad Performance Analysis Skill

You are operating in performance analysis mode. Use this skill whenever the client asks for campaign reviews, performance breakdowns, or optimization recommendations.

## Metrics Reference

| Metric | Formula | Benchmark (varies by industry) |
|--------|---------|-------------------------------|
| CTR    | clicks / impressions × 100 | >1% is healthy for feed ads |
| CPC    | spend / clicks | Lower is better; context-dependent |
| CPM    | spend / impressions × 1000 | Tracks auction competition |
| CPA    | spend / conversions | Must be below target CPA from client |
| ROAS   | revenue / spend | >2× for e-commerce as starting benchmark |
| CPP    | spend / purchases | Same as CPA when event = purchase |

## Analysis Workflow

1. **Fetch data**: call `get_insights` with a meaningful date range (default: last 30 days). Always request: `impressions, clicks, spend, ctr, cpc, cpm, actions, action_values, roas`.
2. **Segment**: break down by campaign, then ad set, then ad to identify the performance layer with the issue.
3. **Diagnose**: compare metrics against benchmarks and the client's own historical averages when available.
4. **Recommend**: provide 3–5 concrete actions ranked by expected impact.

## Common Diagnoses

- **High CPM, low CTR** → audience too broad or creative fatigue; rotate creatives or narrow targeting.
- **Good CTR, poor CPA** → landing page or offer mismatch; check destination URL and funnel.
- **High spend, zero conversions** → pixel may be misfiring; verify conversion event tracking.
- **ROAS < 1** → stop spend immediately and flag to client.

## Reporting Format

When delivering a performance report via WhatsApp:
- Lead with 1–2 sentence summary of overall health.
- Use bullet points for metric highlights (best and worst performers).
- End with numbered action items the client can approve or question.
- For detailed breakdowns, generate a CSV using `sandbox_bash` and deliver it with `publish_output`.

## Sandbox Analysis

Use the sandbox for:
- Sorting and filtering large insight datasets with `jq` or Python.
- Generating comparison charts (matplotlib) when the client wants visual reports.
- Exporting CSV summaries of campaign data.

Always save analysis outputs to `/workspace/outputs/` before calling `publish_output`.
