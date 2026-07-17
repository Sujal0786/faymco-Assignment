# Failure Handling - User Payout Management System

This document explains how the system handles payment provider failures, network drops, crash recovery, and concurrency race conditions.

---

## 1. Concurrency & Integrity Safety

### 1.1 Double-Entry Bookkeeping Ledger
To ensure all cash movements are auditable and cannot be tampered with:
- The `wallet_ledger_entries` table is **immutable**. It supports only `INSERT` queries; `UPDATE` or `DELETE` queries are prohibited.
- Every change to a user's wallet withdrawable balance creates a matching ledger entry. The `balance_after` column maintains a running log of the wallet balance, making it easy to reconcile and detect balance tampering.

### 1.2 Database Row Locks (Pessimistic Locking)
To prevent race conditions (such as a user executing two concurrent withdrawals to drain their account before the balance updates):
- The `WalletService` locks the user's wallet row using `FOR UPDATE` before executing balance updates.
- All subsequent concurrent requests requesting a lock on the same wallet row wait until the holding transaction commits or rolls back, maintaining transaction isolation.

### 1.3 Concurrency on Job Workers
To support scaling the advance payout job:
- When the job runs, it fetches pending sales using `FOR UPDATE SKIP LOCKED`.
- The database locks the matched rows and hides them from other transactions. Multiple concurrent workers can run safely without processing the same sale twice.

---

## 2. Payout Failure Recovery

### 2.1 Withdrawal Failures
When a withdrawal payout is rejected, cancelled, or fails:
1. The payment provider status changes to `failed` / `cancelled` / `rejected`.
2. The `WebhookService` intercepts the callback event.
3. The reserved balance mapped to that withdrawal is released (`reserved_balance -= amount`, `withdrawable_balance += amount`).
4. An immutable refund ledger entry `FAILED_PAYOUT_REFUND` is created, returning the funds to the user.
5. The original withdrawal status is marked as terminally failed, which unlocks the immediate-retry option for the user.

### 2.2 Crash Recovery (Outbox / Idempotent Consumer)
If the job worker crashes or database connectivity drops **after** the Mock Gateway initiates a payout but **before** database updates are committed:
- The database transaction rolls back, leaving no trace of the payout record.
- The next time the advance job runs, it generates the exact same deterministic idempotency key for the sale (e.g. `adv_payout_<saleId>_att_<attempt>`).
- When the gateway receives this duplicate key, its idempotency handler returns the successful response instead of reprocessing. The worker updates the database with the successful state, preventing double payouts.

---

## 3. Webhook Edge Cases

### 3.1 Duplicate Webhooks
- Every webhook event is registered in the `processed_webhook_events` table under the unique index `provider_event_id`.
- If a webhook is delivered multiple times (e.g. 5 times), subsequent events fail the unique database check and are ignored, ensuring the wallet is credited/debited only once.

### 3.2 Out-of-Order Webhooks
- Webhooks can arrive late or in the wrong order (e.g., we receive a `payout.failed` webhook after we already marked it as `succeeded`).
- To handle this, the `WebhookService` locks the payout row and checks if it is in a terminal state (`succeeded`, `failed`, `cancelled`, `rejected`).
- If the payout is already in a terminal state, the webhook is ignored and the transaction commits safely without altering the database.
