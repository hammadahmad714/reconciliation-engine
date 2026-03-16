### Part A03 – Crash-safe refresh worker

This worker uses an attempt-based write model: every run creates a `refresh_job_attempt` record before doing any work, and the actual reconciled results are written inside a single transaction that inserts a `refresh_result_set`, its `refresh_result_rows`, and an immutable `refresh_job_result`. An attempt is only marked succeeded after the transaction commits. If the process crashes mid-transaction, Postgres rolls back the whole write; the attempt remains non-successful and is visible for audit.

Retries never mutate prior attempts. A retry simply creates a new attempt and a new result set; previous failed attempts are left as-is, so history is append-only and reconstructable. This avoids classic failure modes like “delete-and-reinsert”, “blind upsert”, and “skip if existing”, all of which can hide partial writes or backslide metrics when old data overwrites newer data.

Success is derived purely from the presence of a committed immutable result row tied to a succeeded attempt, not from in-process state. Crash mid-write is safe because there is no point at which the database shows a “success” without a complete, internally consistent result set. Provider retries use exponential backoff with jitter, batch guards pause noisy batches, and per-account failure state ensures repeated failures are flagged for manual review instead of retrying forever.

