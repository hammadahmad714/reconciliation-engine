# Part C07 – Live Debugging Investigation
## The 1.3 Million View Gap

### First Step I Would Run
I would first compare the dashboard number against a database-side high-water total for the client, using post publish-time attribution rather than current account ownership. That immediately tells me whether the gap is in ingestion/reconciliation/storage or in the API/dashboard query layer. The clue that the dashboard API was optimized last week makes this the fastest high-signal split.

```sql
WITH client_posts AS (
  SELECT p.id
  FROM platform_posts p
  JOIN client_account_assignments ca
    ON ca.account_id = p.account_id
   AND p.published_at <@ ca.valid_during
  WHERE ca.client_id = $1
),
post_high_water AS (
  SELECT ms.post_id, MAX(ms.views) AS high_water_views
  FROM post_metric_snapshots ms
  JOIN client_posts cp ON cp.id = ms.post_id
  GROUP BY ms.post_id
)
SELECT COALESCE(SUM(high_water_views), 0) AS total_high_water_views
FROM post_high_water;
```

```bash
curl -s "https://api.example.com/clients/$CLIENT_ID/dashboard/summary" \
  -H "Authorization: Bearer $TOKEN"
```

If SQL is near 3.4M and the API returns 2.1M, the defect is almost certainly query/filtering logic. If SQL is also near 2.1M, I would shift immediately to ingestion, reconciliation, or job execution.

---

# Ranked Root Causes

## 1. Dashboard/API query is summing latest snapshots instead of high-water values
This is the strongest lead because the discrepancy has grown over weeks, not spiked on one day, and the dashboard API was optimized last week. A query rewrite that switched from historical max to latest-observed metrics would silently undercount whenever providers regress, posts disappear from current scrapes, or banned/unbanned accounts are inconsistently filtered.

### Diagnostic Query
```sql
WITH client_posts AS (
  SELECT p.id
  FROM platform_posts p
  JOIN client_account_assignments ca
    ON ca.account_id = p.account_id
   AND p.published_at <@ ca.valid_during
  WHERE ca.client_id = $1
),
latest AS (
  SELECT DISTINCT ON (ms.post_id) ms.post_id, ms.views
  FROM post_metric_snapshots ms
  JOIN client_posts cp ON cp.id = ms.post_id
  ORDER BY ms.post_id, ms.observed_at DESC, ms.id DESC
),
high_water AS (
  SELECT ms.post_id, MAX(ms.views) AS views
  FROM post_metric_snapshots ms
  JOIN client_posts cp ON cp.id = ms.post_id
  GROUP BY ms.post_id
)
SELECT
  (SELECT COALESCE(SUM(views), 0) FROM latest) AS latest_total,
  (SELECT COALESCE(SUM(views), 0) FROM high_water) AS high_water_total;
```

### Permanent Fix
Move the dashboard source of truth to a database view or materialized view that explicitly aggregates `MAX(views)` per post. Add a regression test around the API endpoint proving totals do not decrease when latest snapshots regress below historical max.

## 2. Reassigned accounts are being attributed by current owner instead of post publish time
Three accounts moved six weeks ago, which lines up with a multi-week drift. If historical posts from those accounts are still attributed to the old client, this client’s dashboard will miss a large legacy tail while manual platform verification still sees the full account totals.

### Diagnostic Query
```sql
SELECT
  a.platform_handle,
  COUNT(*) AS posts,
  COALESCE(SUM(hw.views), 0) AS high_water_views
FROM creator_accounts a
JOIN platform_posts p ON p.account_id = a.id
JOIN LATERAL (
  SELECT MAX(ms.views) AS views
  FROM post_metric_snapshots ms
  WHERE ms.post_id = p.id
) hw ON true
LEFT JOIN client_account_assignments ca
  ON ca.account_id = a.id
 AND p.published_at <@ ca.valid_during
WHERE a.id IN (
  SELECT account_id
  FROM client_account_assignments
  GROUP BY account_id
  HAVING COUNT(*) > 1
)
GROUP BY a.platform_handle
ORDER BY high_water_views DESC;
```

### Permanent Fix
Make publish-time attribution the only supported path in SQL and API code. Ban “current account owner” joins for reporting. Add a schema-level reporting view keyed by `platform_posts.published_at <@ client_account_assignments.valid_during`.

## 3. Disappeared or temporarily unavailable posts are being excluded from totals
Two accounts were marked banned three weeks ago and later unbanned. If the system removed posts that disappeared from provider output during that period, totals would shrink and stay low even after unban. This also fits a slow-growing gap.

### Diagnostic Query
```sql
WITH latest_run AS (
  SELECT id
  FROM scrape_runs
  WHERE provider IN ('provider_a', 'provider_b')
  ORDER BY started_at DESC
  LIMIT 1
),
historical_posts AS (
  SELECT DISTINCT p.id, p.account_id
  FROM platform_posts p
  JOIN post_metric_snapshots ms ON ms.post_id = p.id
),
missing_latest AS (
  SELECT hp.id
  FROM historical_posts hp
  LEFT JOIN run_post_observations rpo
    ON rpo.post_id = hp.id
   AND rpo.run_id = (SELECT id FROM latest_run)
   AND rpo.seen = true
  WHERE rpo.post_id IS NULL
)
SELECT COUNT(*) AS missing_posts,
       COALESCE(SUM(hw.views), 0) AS missing_high_water_views
FROM missing_latest ml
JOIN LATERAL (
  SELECT MAX(ms.views) AS views
  FROM post_metric_snapshots ms
  WHERE ms.post_id = ml.id
) hw ON true;
```

### Permanent Fix
Do not base reporting on “present in latest run”. Report from immutable posts plus high-water snapshots, and track absence separately. Add an alert on large high-water volume currently missing from the latest scrape.

---

# Additional Possible Causes

## 4. Banned account filtering logic is still suppressing previously banned accounts
The “banned then unbanned” clue suggests stale flags or cached account state in the API. Fix: make banned status time-aware and auditable; do not permanently exclude historical post totals.

## 5. BullMQ backlog or repeated job failures after the cron migration
The cron server moved four weeks ago, matching the timeline. If refresh jobs stopped running for part of the fleet, totals would lag progressively. Fix: monitor queue lag, failed jobs, and per-account freshness SLA.

## 6. Cron migration changed scheduler scope or account routing
A migrated cron host can drop environment config, timezone, or client/account shards. Fix: compare pre/post migration scheduled account sets and add daily completeness checks against expected 38 accounts.

## 7. Provider reconciliation is preserving stale low values or discarding one provider
If one provider stopped contributing and the reconciler now trusts the lower source, totals can drift down. Fix: persist per-provider provenance and alert on provider disagreement or sudden provider coverage loss.

---

# Debugging Logic Summary

The first clue I would anchor on is the API optimization last week, because it provides a crisp hypothesis with a fast validation path: compare dashboard output to a database high-water total. If those numbers diverge, I investigate the API query, especially whether it switched to latest snapshots, latest-run presence, current account ownership, or banned-account filters.

The reassignment clue drives suspect #2 because it explains a persistent undercount tied to a specific six-week window. The banned/unbanned clue drives suspect #3 because temporary provider disappearance often causes posts to vanish from dashboards when reporting is incorrectly coupled to latest scrape visibility.

I ranked BullMQ backlog and cron migration lower because they usually create freshness gaps, not necessarily a clean 1.3M undercount unless a subset of accounts stopped refreshing entirely. They are still plausible because the discrepancy grew over weeks, so I would inspect queue lag and per-account scrape recency immediately after the high-water vs API comparison.

In a live incident, the sequence is: run the high-water SQL, compare to the REST response, then branch. If SQL matches platform reality, inspect API SQL and filters. If SQL is also low, inspect assignment joins, disappeared-post volume, scrape completeness per account, then queue/scheduler health. That path minimizes speculation and narrows the fault domain quickly.
