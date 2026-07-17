# Assumptions & Trade-offs - User Payout Management System

This document outlines the core business assumptions, architectural choices, and design trade-offs made during the development of this payout management system.

---

## 1. Core Assumptions

### 1.1 Money Handling & Rounding
- **Base Unit**: All money values are handled as integer **paise** (1 Rupee = 100 paise) to avoid IEEE 754 floating-point rounding errors.
- **Advance Calculation**: The advance is exactly 10% of earning. If 10% contains a fraction of a paise, we apply **standard half-up rounding** (`Math.round(earning * 0.1)`). For example:
  - Earnings = ₹40.15 (4015 paise). 10% = 401.5 paise -> Rounded to 402 paise.
  - Earnings = ₹40.14 (4014 paise). 10% = 401.4 paise -> Rounded to 401 paise.

### 1.2 Withdrawal 24-Hour Limits & Retries
- **24-Hour Definition**: The 24-hour limit is evaluated based on the `requested_at` timestamp of the user's latest **non-failed** withdrawal request. If a user has a withdrawal in status `created`, `processing`, or `succeeded` in the last 24 hours, they cannot request a new normal withdrawal.
- **Retry Allowance**: If a withdrawal request fails terminally (status `failed`, `cancelled`, `rejected`), its reserved balance is refunded to the withdrawable balance. The user can request an immediate **retry** for this amount, bypassing the 24-hour block, under these conditions:
  - The retry request must pass the `retryOfWithdrawalId` referencing the failed request.
  - The referenced request must be in a terminal failed state and must not have already been retried.
  - The retry amount must be **less than or equal to** the original failed request's amount. This prevents bypassing the 24-hour limit to withdraw additional new earnings.

### 1.3 Double-Entry Accounting for Advance Payouts
- **Direct Payout Model**: The 10% advance payout is sent directly to the user's external bank account/wallet via the payment provider, rather than being added to their internal withdrawable wallet balance.
- **Double-Entry Logging**: To maintain a transparent and audit-compliant ledger, when an advance payout succeeds, the system posts both a **Credit** and a **Debit** of equal value to the user's wallet ledger under the `ADVANCE_PAYOUT` entry type:
  - *Credit*: Logs the user earning the advance payout commission (+).
  - *Debit*: Logs the transfer/withdrawal of those funds to the user's external account (-).
  - *Result*: The net impact on the *withdrawable* wallet balance is zero, which prevents users from double-withdrawing the advance while keeping the immutable ledger fully synchronized with the actual cash flow.

---

## 2. Technical Trade-offs

### 2.1 Knex.js vs. Full ORMs (Sequelize / TypeORM)
- **Trade-off**: We chose **Knex.js** (query builder) over full ORMs like Sequelize or TypeORM.
- **Why**: ORMs abstract SQL transactions and row locks behind complex object lifecycle hooks, which can make fine-grained control of locks like `SELECT ... FOR UPDATE` and `FOR UPDATE SKIP LOCKED` prone to framework-level overhead or bugs. Knex gives us lightweight, exact, and review-defendable control over SQL queries and lock scopes, which is critical for finance-related systems.

### 2.2 In-Memory Mock Gateway vs. Persistent Mock Gateway
- **Trade-off**: We chose to mock the payout gateway using an in-memory cache for transaction idempotency rather than writing to a separate table or using an external mock server.
- **Why**: This keeps the setup simple and zero-dependency, while fully demonstrating how a real payment provider handles idempotency (rejecting or returning cached responses for the same key). In production, this would communicate over HTTPS to an external provider (like Cashfree or Razorpay) using their native idempotency headers.

### 2.3 Local PostgreSQL vs. SQLite for Tests
- **Trade-off**: We ran integration tests directly against a local PostgreSQL test database (`faym_payout_test_db`) rather than using SQLite in-memory.
- **Why**: SQLite does not support key PostgreSQL concurrency features used in our code, such as `FOR UPDATE` row-level locks, `SKIP LOCKED` worker queues, and partial unique indexes (`CREATE UNIQUE INDEX ... WHERE ...`). Testing on the same database engine used in development ensures the validity of lock mechanisms and constraints.
