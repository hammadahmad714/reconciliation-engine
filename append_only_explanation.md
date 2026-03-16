### Append-only enforcement

Metric snapshots live in `post_metric_snapshots`, which is intentionally modeled as an immutable event log. At the database level, a `BEFORE UPDATE OR DELETE` trigger (`trg_append_only_post_metric_snapshots`) calls `enforce_append_only_post_metric_snapshots()`. That function raises an error for any `UPDATE` or `DELETE`, using a SQLSTATE that makes it obvious this is a policy violation. As a result, the only legal operation on that table is `INSERT`. Consumers who want to “change” metrics must instead append new rows with later `observed_at` timestamps.

For post identity, `platform_posts` has a separate trigger (`trg_immutable_platform_posts`) that rejects changes to `account_id` or `platform_post_id`. This prevents accidental reassignment of a post to a different account, which would otherwise rewrite historical attribution. Combined with the non-overlapping `client_account_assignments` ranges, this preserves a stable mapping from `(post, published_at)` to the owning client. High water mark queries, regressions, and disappeared-post detection are all computed over the append-only log, not via mutable totals, so historical states remain reproducible and auditable over time.

{
  "cells": [],
  "metadata": {
    "language_info": {
      "name": "python"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 2
}