# Low-Level Design (LLD) - User Payout Management System

This document provides a comprehensive Low-Level Design for the Affiliate Sale Payout Management System.

---

## 1. System Components & Responsibilities

The system is designed using a clean, layered architecture:

- **Controllers**: Parse requests, execute basic HTTP validation, delegate domain actions to services, and map service results to HTTP responses.
- **Routes**: Mount REST API routes and apply middleware.
- **Validation Middleware**: Intercepts requests to validate parameter types, structural integrity, and presence of mandatory headers (e.g. `Idempotency-Key`).
- **Services (Domain Logic)**:
  - `WalletService`: Performs atomic withdrawable/reserved balance operations, checks funds, locks wallet rows, and inserts immutable ledger entries.
  - `AdvancePayoutService`: Coordinates automatic 10% advance commissions for eligible pending sales. Uses row-level locks to support safe concurrent worker execution.
  - `ReconciliationService`: Allows administrators to reconcile sales, calculating remainder adjustments or debt collections.
  - `WithdrawalService`: Directs manual user withdrawal requests, validating available balances and enforcing the 24-hour frequency limit and retry exceptions.
  - `WebhookService`: Integrates callback status updates from the payment provider to finalize payouts or recover failed funds.
- **MockPayoutGateway**: Simulates payout provider processing, timeout delays, and error states while maintaining an in-memory idempotency cache.
- **Database Layer**: Knex schema configurations, foreign keys, row locks, partial unique indexes, and audit ledgers.

---

## 2. Status Machines

### Sale Status State Machine
```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> approved : Admin Reconcile (Credit Remainder)
    pending --> rejected : Admin Reconcile (Debit Paid Advance)
    approved --> [*]
    rejected --> [*]
```

### Payout Status State Machine
```mermaid
stateDiagram-v2
    [*] --> created
    created --> processing : Initiated via Gateway
    processing --> succeeded : Webhook / Gateway Success
    processing --> failed : Webhook / Gateway Failure (Refund Balance)
    processing --> cancelled : Webhook Cancellation (Refund Balance)
    processing --> rejected : Webhook Rejection (Refund Balance)
    succeeded --> [*]
    failed --> [*]
    cancelled --> [*]
    rejected --> [*]
```

---

## 3. Data Flow Sequences

### Sequence 1: Advance Payout Workflow
```mermaid
sequenceDiagram
    autonumber
    actor Worker as Job Worker
    participant Job as AdvancePayoutService
    participant DB as PostgreSQL
    participant Gateway as MockPayoutGateway
    participant Wallet as WalletService

    Worker->>Job: Trigger runAdvancePayoutJob()
    Note over Job,DB: Start Transaction
    Job->>DB: Fetch pending sale (FOR UPDATE SKIP LOCKED)
    DB-->>Job: Eligible Sale Row
    Job->>Job: Calculate 10% Advance (Half-Up Rounded)
    Job->>DB: Insert Payout & PayoutAllocation (status: created)
    Note over Job,DB: Commit Transaction & Release DB Lock
    Job->>DB: Update Payout & Allocation to 'processing'
    Job->>Gateway: initiatePayout(idempotencyKey)
    Gateway-->>Job: Gateway Response (e.g. succeeded)
    Note over Job,DB: Start Transaction
    alt Payout Succeeded
        Job->>DB: Update Payout & Allocation to 'succeeded'
        Job->>DB: Set sale.advance_paid_amount = advanceAmount
        Job->>Wallet: adjustBalance(+advanceAmount, type: ADVANCE_PAYOUT)
        Wallet->>DB: Update wallet (withdrawable_balance += advanceAmount)
        Wallet->>DB: Insert Credit Ledger Entry
        Job->>Wallet: adjustBalance(-advanceAmount, type: ADVANCE_PAYOUT)
        Wallet->>DB: Update wallet (withdrawable_balance -= advanceAmount)
        Wallet->>DB: Insert Debit Ledger Entry
    else Payout Failed
        Job->>DB: Update Payout & Allocation to 'failed'
    end
    Note over Job,DB: Commit Transaction
    Job-->>Worker: Job Summary
```

### Sequence 2: Reconciliation Workflow
```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant Controller as SaleController
    participant Service as ReconciliationService
    participant DB as PostgreSQL
    participant Wallet as WalletService

    Admin->>Controller: POST /api/admin/sales/:id/reconcile { status, adminId }
    Controller->>Service: reconcileSale({ saleId, status, adminId })
    Note over Service,DB: Start Transaction
    Service->>DB: Get Sale Row (FOR UPDATE)
    alt Sale is Reconciled (Duplicate Request)
        alt Status Matches
            Service-->>Controller: Return success (Idempotent bypass)
        else Status Conflicts
            Service-->>Controller: Throw 409 Conflict
        end
    else Sale is Pending
        alt Approved
            Service->>Service: Calculate adjustment = earnings - advancePaid
            Service->>DB: Update sale status to 'approved'
            Service->>Wallet: adjustBalance(+adjustment, type: APPROVED_SALE_REMAINDER)
            Wallet->>DB: Credit withdrawable balance
            Wallet->>DB: Insert Credit Ledger Entry
        else Rejected
            Service->>Service: Calculate adjustment = -advancePaid
            Service->>DB: Update sale status to 'rejected'
            Service->>Wallet: adjustBalance(-advancePaid, type: REJECTED_SALE_ADJUSTMENT)
            Wallet->>DB: Debit withdrawable balance (can go negative)
            Wallet->>DB: Insert Debit Ledger Entry
        end
        Note over Service,DB: Commit Transaction
        Service-->>Controller: Return Reconciliation Result
        Controller-->>Admin: HTTP 200 Success Response
    end
```

### Sequence 3: User Withdrawal Workflow
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Controller as WithdrawalController
    participant Service as WithdrawalService
    participant DB as PostgreSQL
    participant Wallet as WalletService
    participant Gateway as MockPayoutGateway

    User->>Controller: POST /api/users/:id/withdrawals (Header: Idempotency-Key, Body: amount)
    Controller->>Service: requestWithdrawal({ userId, amount, idempotencyKey, retryOfWithdrawalId })
    Note over Service,DB: Start Transaction
    Service->>DB: Check Idempotency Key
    alt Duplicate Key
        Service-->>Controller: Return cached request (Idempotent bypass)
    else New Key
        Service->>Wallet: getWalletWithLock(userId) (FOR UPDATE)
        Wallet-->>Service: Wallet details
        Service->>Service: Validate Available Balance
        alt Insufficient Funds
            Service-->>Controller: Throw 422 Insufficient Funds
        end
        alt Is Normal Withdrawal (no retry ID)
            Service->>DB: Verify no non-failed withdrawal in last 24 hours
            alt Exceeds Limit
                Service-->>Controller: Throw 422 Withdrawal Limit Exceeded
            end
        else Is Immediate Retry (retry ID provided)
            Service->>DB: Verify retry conditions (original failed, same/lesser amount, not retried yet)
            alt Invalid Retry
                Service-->>Controller: Throw 400 Invalid Retry Request
            end
        end
        Service->>DB: Insert Withdrawal Request (status: created)
        Service->>Wallet: reserveBalance(amount)
        Wallet->>DB: Update wallet (withdrawable -= amount, reserved += amount)
        Wallet->>DB: Insert WITHDRAWAL_RESERVED Ledger Entry
        Service->>DB: Insert Payout record (status: created)
        Service->>DB: Update statuses to 'processing'
        Note over Service,DB: Commit Transaction & Release DB Lock
        Service->>Gateway: initiatePayout(idempotencyKey)
        Gateway-->>Service: Gateway response (e.g. succeeded)
        Note over Service,DB: Start Transaction
        alt Gateway Succeeded
            Service->>DB: Update statuses to 'succeeded'
            Service->>Wallet: completeReservedBalance(amount)
            Wallet->>DB: Update wallet (reserved -= amount)
            Wallet->>DB: Insert WITHDRAWAL_COMPLETED Ledger Entry
        else Gateway Failed
            Service->>DB: Update statuses to 'failed'
            Service->>Wallet: releaseReservedBalance(amount)
            Wallet->>DB: Update wallet (reserved -= amount, withdrawable += amount)
            Wallet->>DB: Insert FAILED_PAYOUT_REFUND Ledger Entry
        end
        Note over Service,DB: Commit Transaction
        Service-->>Controller: Return Result
        Controller-->>User: HTTP 201 Created Response
    end
```

### Sequence 4: Failed Payout Webhook Recovery
```mermaid
sequenceDiagram
    autonumber
    actor Gateway as Payout Provider
    participant Controller as WebhookController
    participant Service as WebhookService
    participant DB as PostgreSQL
    participant Wallet as WalletService

    Gateway->>Controller: POST /api/webhooks/payout-provider { eventId, eventType, payoutId }
    Controller->>Service: processWebhook(event)
    Note over Service,DB: Start Transaction
    Service->>DB: Check if eventId is in processed_webhook_events
    alt Duplicate Webhook Event
        Service-->>Controller: Return success (Idempotent bypass)
    else New Webhook Event
        Service->>DB: Insert eventId in processed_webhook_events
        Service->>DB: Get Payout Row (FOR UPDATE)
        alt Payout is already Succeeded/Failed (Terminal)
            Service-->>Controller: Return success (Out-of-order webhook ignored)
        else Payout is Processing
            Service->>DB: Update Payout & Withdrawal Request to 'failed'
            Service->>Wallet: releaseReservedBalance(amount)
            Wallet->>DB: Update wallet (reserved -= amount, withdrawable += amount)
            Wallet->>DB: Insert FAILED_PAYOUT_REFUND Ledger Entry
            Note over Service,DB: Commit Transaction
            Service-->>Controller: Return recovery confirmation
            Controller-->>Gateway: HTTP 200 OK
        end
    end
```

---

## 4. Class Design Diagram

This diagram displays the service abstractions and their relations:

```mermaid
classDiagram
    class UserController {
        +createUser(req, res, next)
        +getUser(req, res, next)
    }

    class SaleController {
        +createSale(req, res, next)
        +getSales(req, res, next)
        +getSaleById(req, res, next)
        +reconcileSale(req, res, next)
        +reconcileBatch(req, res, next)
    }

    class PayoutController {
        +runAdvancePayouts(req, res, next)
        +getAdvancePayouts(req, res, next)
    }

    class WalletController {
        +getWallet(req, res, next)
        +getLedger(req, res, next)
    }

    class WithdrawalController {
        +createWithdrawal(req, res, next)
        +getUserWithdrawals(req, res, next)
        +getWithdrawalById(req, res, next)
    }

    class WebhookController {
        +handleWebhook(req, res, next)
    }

    class WalletService {
        +getWalletWithLock(userId, trx) Wallet
        +adjustBalance(params, trx) Object
        +reserveBalance(params, trx) Object
        +completeReservedBalance(params, trx) Object
        +releaseReservedBalance(params, trx) Object
    }

    class AdvancePayoutService {
        +runAdvancePayoutJob(simulateStatus) Array
    }

    class ReconciliationService {
        +reconcileSale(params) Object
        +reconcileBatch(params) Object
    }

    class WithdrawalService {
        +requestWithdrawal(params) Object
    }

    class WebhookService {
        +processWebhook(event) Object
    }

    class MockPayoutGateway {
        -cache Map
        +initiatePayout(params) Object
    }

    UserController --> WalletService
    SaleController --> ReconciliationService
    PayoutController --> AdvancePayoutService
    WithdrawalController --> WithdrawalService
    WebhookController --> WebhookService

    AdvancePayoutService --> WalletService
    AdvancePayoutService --> MockPayoutGateway
    ReconciliationService --> WalletService
    WithdrawalService --> WalletService
    WithdrawalService --> MockPayoutGateway
    WebhookService --> WalletService
```

---

## 5. Concurrency & Idempotency Controls

1. **Row-Level Locking**: Database updates impacting user wallets are wrapped in transactions and lock the matching row via `FOR UPDATE`. This blocks concurrent operations (e.g. multiple concurrent withdrawals or webhook executions) from creating race conditions.
2. **Worker Concurrency**: The advance payout job locks pending sale rows using `FOR UPDATE SKIP LOCKED`. If two worker threads execute simultaneously, they process disjoint sales without collision.
3. **Idempotency Keys**:
   - Webhook events: Checked and stored in `processed_webhook_events` (primary unique key is `provider_event_id`).
   - User withdrawals: Guarded by a unique index on `idempotency_key` in the `withdrawal_requests` table.
   - Balance adjustments: The ledger entries enforce uniqueness on `idempotency_key` (constructed deterministically: e.g. `reconcile_sale_<id>_status_<status>`), making duplicate updates mathematically impossible.
