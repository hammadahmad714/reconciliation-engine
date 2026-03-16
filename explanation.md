# Reconciliation Engine Explanation

## Overview

The reconciler is designed as a deterministic, in-memory pipeline built around a `reconcile()` function. The function orchestrates URL normalization, post matching, metric reconciliation, client attribution, and anomaly detection according to the requirement.

The design prioritizes **data integrity, deterministic outputs, and auditability** over aggressive merging. All reconciliation decisions include provenance so discrepancies can be inspected later.

The system assumes provider data can be incomplete, inconsistent, or temporarily incorrect. Because of this, the engine avoids destructive assumptions such as deleting posts or blindly trusting the latest metric values.

---

# 1. Share URL handling without HTTP requests

TikTok share links (`vm.tiktok.com/...`) normally resolve through a redirect chain to the canonical `tiktok.com/@user/video/<id>` URL.

Performing HTTP resolution during reconciliation would introduce several problems:

- network latency
- nondeterministic behavior
- caching inconsistencies
- rate-limit failures
- dependency on external services

Instead, `normalizeUrl()` performs **deterministic pattern extraction**.

Canonical video URLs are normalized to:
https://tiktok.com/@handle/video/
<video_id>

Normalization steps include:

- host normalization (`vm.tiktok.com`, `www.tiktok.com` → `tiktok.com`)
- stripping query parameters and fragments
- removing trailing slashes
- extracting platform video IDs when present

Share links that do not contain a platform video ID are preserved as normalized short URLs while explicitly setting:
platformId = null

This intentionally encodes uncertainty. It signals that the URL represents a TikTok share link but the underlying post ID is unknown.

Those records can later be resolved through external signals such as provider data, redirect logs, or delayed resolution jobs.

---

# 2. Caption matching strategy and limitations

Caption matching is intentionally conservative because aggressive fuzzy matching is a common source of silent data corruption.

The fallback function `captionsTruncationMatch()` only triggers when:

1. one caption ends with `...`
2. the truncated portion is ≤ 150 characters
3. the full caption strictly starts with the truncated prefix
4. both posts belong to the same account
5. timestamps fall within a small window

This specifically targets the known provider behavior where captions are prefix-truncated.

The function deliberately rejects:

- identical long prefixes without truncation markers
- truncated strings longer than 150 characters
- matches across different accounts
- posts outside the timestamp window

This prevents merging posts that share templated intros (which is common in influencer marketing content) but diverge later.

Remaining edge cases include:

- providers truncating captions mid-string
- Unicode normalization differences
- dropped hashtags
- emoji variations

Handling those reliably would require token-level similarity scoring and offline evaluation on real datasets. That complexity was intentionally excluded here to reduce the risk of false merges.

---

# 3. Fate of post `7320111222`

Post `7320111222` appears only in the historical snapshot and does not appear in either provider response today.

The reconciler therefore classifies it as:
status: "historical_only"
reason: "missing_from_providers"

It is included in the `disappeared_posts` list.

This design avoids making destructive assumptions.

The disappearance could mean:

- the post was deleted
- a provider temporarily failed to return it
- the scraping pipeline missed it

Removing the post immediately would introduce **silent metric drift** in historical reporting.

Instead, the system preserves the snapshot while clearly flagging it as missing from the latest scrape.

An anomaly record (`missing_from_all_providers`) is also emitted so monitoring systems can track these cases.

---

# 4. Selecting the correct view count for `7321456789`

For post `7321456789`, the observed values are:
historical snapshot: 46000
provider A: 45200
provider B: 44800

Both providers now report **lower values than the historical snapshot**.

The reconciliation rule is:
if any provider value >= historical:
choose max(provider_values)
else:
preserve historical value

Because both providers report lower values, the system treats this as a **metric regression**.

The reconciler therefore preserves the historical value `46000` and emits an anomaly tag:
regression_vs_history

This avoids incorrectly reducing cumulative metrics due to temporary provider errors.

Provenance for the metric records:

- historical value
- provider values
- selected value
- anomaly flags

---

# 5. Why we do not simply use `max(views)`

Taking the maximum value across historical and provider data would introduce a critical failure mode.

Example:

If a provider once reported an incorrect value such as:
views = 1,000,000,000

That value would permanently dominate reconciliation results, preventing recovery even after providers begin returning correct numbers.

Instead, the engine treats **history as a floor**, not an unbounded maximum.

Rules:

- prefer the highest **current provider value**
- enforce monotonic growth relative to history
- treat regressions as anomalies

This allows the system to recover from historical outliers while maintaining monotonic metrics under normal conditions.

---

# 6. Safeguards against incorrect historical snapshots

Historical snapshots are never blindly trusted.

For every reconciled metric, the engine records:

- the historical value
- all provider values
- the chosen value
- anomaly flags

Historical values only override provider data when the current values move **backwards**.

This prevents:

- silent data corruption
- historical outliers permanently dominating reconciliation
- loss of auditability

Because snapshots are not merged directly into the main result set, callers can rerun reconciliation with corrected snapshots without hidden state inside the engine.

---

# 7. Production improvements

In a production system, this engine would be extended with:

- token-level caption similarity models
- configurable provider disagreement thresholds
- persistent provenance storage for audit trails
- structured anomaly severity levels
- richer disappearance tracking (temporary vs long-term)
- provider health monitoring
- reconciliation policy versioning

Policy versioning is particularly important so that rule changes do not retroactively rewrite historical metrics without traceability.

The reconciliation layer would also sit behind a small service interface with contract tests and realistic synthetic datasets instead of only hand-crafted examples.