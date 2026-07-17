# API Documentation - User Payout Management System

This document outlines the API endpoints, request/response formats, headers, and standard status codes.

---

## 1. Port & Setup Details
By default, the server boots on port `3000`. You can change this via the `PORT` variable in the `.env` file.
All API endpoints are prefixed with `/api`.

---

## 2. API Endpoints

### 2.1 Users & Brands

#### Create User
- **Method**: `POST`
- **URL**: `/api/users`
- **Request Body**:
```json
{
  "username": "john_doe",
  "email": "john@example.com"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
      "username": "john_doe",
      "email": "john@example.com",
      "created_at": "2026-07-17T20:19:22.000Z"
    },
    "wallet": {
      "id": "fbc66ba8-5c4e-4f05-87d9-3a3f5a2b1cd5",
      "withdrawableBalance": "0",
      "reservedBalance": "0"
    }
  },
  "message": "User created successfully"
}
```

#### Get User Profile
- **Method**: `GET`
- **URL**: `/api/users/:userId`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
    "username": "john_doe",
    "email": "john@example.com",
    "created_at": "2026-07-17T20:19:22.000Z"
  }
}
```

#### Create Brand
- **Method**: `POST`
- **URL**: `/api/brands`
- **Request Body**:
```json
{
  "name": "brand_1"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": "1ab49c2d-98e3-4d7a-8f5c-897b91d2ab45",
    "name": "brand_1",
    "created_at": "2026-07-17T20:19:22.000Z"
  },
  "message": "Brand created successfully"
}
```

---

### 2.2 Sales

#### Record Sale
- **Method**: `POST`
- **URL**: `/api/sales`
- **Request Body**:
```json
{
  "userId": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
  "brandId": "1ab49c2d-98e3-4d7a-8f5c-897b91d2ab45",
  "externalReference": "sale_ref_101",
  "earning": "40.00"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": "ef8b456e-8260-466a-b22c-7b0f111ee25f",
    "userId": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
    "brandId": "1ab49c2d-98e3-4d7a-8f5c-897b91d2ab45",
    "externalReference": "sale_ref_101",
    "status": "pending",
    "earningAmount": 4000,
    "earningRupees": "40.00",
    "advancePaidAmount": 0,
    "createdAt": "2026-07-17T20:19:22.000Z"
  },
  "message": "Sale recorded successfully"
}
```

#### Get Sales List (with pagination and filters)
- **Method**: `GET`
- **URL**: `/api/sales?userId=...&brandId=...&status=pending&page=1&limit=10`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "sales": [
      {
        "id": "ef8b456e-8260-466a-b22c-7b0f111ee25f",
        "user_id": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
        "brand_id": "1ab49c2d-98e3-4d7a-8f5c-897b91d2ab45",
        "external_reference": "sale_ref_101",
        "status": "pending",
        "earning_amount": "4000",
        "earningRupees": "40.00",
        "advance_paid_amount": "0",
        "advancePaidRupees": "0.00"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 10
    }
  }
}
```

---

### 2.3 Advance Payouts

#### Run Advance Payout Job (Demonstration)
- **Method**: `POST`
- **URL**: `/api/admin/advance-payouts/run`
- **Request Body**:
```json
{
  "simulateStatus": "success"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "saleId": "ef8b456e-8260-466a-b22c-7b0f111ee25f",
      "payoutId": "9ac18ba6-f45e-405e-87d9-2a3b5a2b1cd5",
      "status": "succeeded",
      "amount": 400,
      "amountRupees": "4.00"
    }
  ],
  "message": "Advance payout job run completed. Processed 1 sales."
}
```

---

### 2.4 Reconciliation

#### Reconcile Single Sale
- **Method**: `POST`
- **URL**: `/api/admin/sales/:saleId/reconcile`
- **Request Body**:
```json
{
  "status": "approved",
  "adminId": "admin_1",
  "batchId": "batch_reconcile_1"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "saleId": "ef8b456e-8260-466a-b22c-7b0f111ee25f",
    "previousStatus": "pending",
    "finalStatus": "approved",
    "adjustment": "3600",
    "adjustmentRupees": "36.00"
  },
  "message": "Sale reconciled successfully"
}
```

---

### 2.5 Wallet

#### Fetch Wallet Balance
- **Method**: `GET`
- **URL**: `/api/users/:userId/wallet`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "fbc66ba8-5c4e-4f05-87d9-3a3f5a2b1cd5",
    "userId": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
    "withdrawableBalancePaise": 3600,
    "withdrawableBalanceRupees": "36.00",
    "reservedBalancePaise": 0,
    "reservedBalanceRupees": "0.00",
    "version": 2
  }
}
```

#### Fetch Wallet Ledger Entries (Audit log)
- **Method**: `GET`
- **URL**: `/api/users/:userId/wallet/ledger`
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "c8cb1a8c-94e4-4d8e-be8e-161b122242f9",
      "userId": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
      "saleId": "ef8b456e-8260-466a-b22c-7b0f111ee25f",
      "payoutId": null,
      "entryType": "APPROVED_SALE_REMAINDER",
      "amountPaise": 3600,
      "amountRupees": "36.00",
      "balanceAfterPaise": 3600,
      "balanceAfterRupees": "36.00",
      "idempotencyKey": "reconcile_sale_ef8b456e-8260-466a-b22c-7b0f111ee25f_status_approved",
      "description": "Reconciled by admin_1. Prev status: pending, Final status: approved. Batch: batch_reconcile_1"
    }
  ]
}
```

---

### 2.6 Withdrawals

#### Create Withdrawal Request
- **Headers**:
  - `Idempotency-Key`: `uuid-value` (Required)
- **Method**: `POST`
- **URL**: `/api/users/:userId/withdrawals`
- **Request Body**:
```json
{
  "amount": "20.00",
  "retryOfWithdrawalId": null,
  "simulateStatus": "success"
}
```
- **Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "withdrawalRequest": {
      "id": "e9cb2b8c-54ea-4c8d-8fe3-7ae548de0b67",
      "userId": "58eb3d8e-7360-449e-b9b5-6f02888ec25f",
      "amountPaise": 2000,
      "amountRupees": "20.00",
      "status": "succeeded",
      "requestedAt": "2026-07-17T20:19:22.000Z",
      "idempotencyKey": "withdrawal_key_101"
    },
    "payout": {
      "id": "e9cb2b8c-54ea-4c8d-8fe3-7ae548de0b67",
      "status": "succeeded",
      "providerReference": "prov_a7ecda29bc1e",
      "failureReason": null
    }
  },
  "message": "Withdrawal initiated successfully"
}
```

---

### 2.7 Webhooks

#### Payout Provider Webhook Callback
- **Method**: `POST`
- **URL**: `/api/webhooks/payout-provider`
- **Request Body**:
```json
{
  "eventId": "evt_987654",
  "eventType": "payout.failed",
  "payoutId": "e9cb2b8c-54ea-4c8d-8fe3-7ae548de0b67",
  "providerReference": "prov_a7ecda29bc1e",
  "failureReason": "Beneficiary account details invalid"
}
```
- **Response (200 OK)**:
```json
{
  "success": true,
  "message": "Webhook processed successfully: status updated to failed",
  "payoutId": "e9cb2b8c-54ea-4c8d-8fe3-7ae548de0b67",
  "status": "failed"
}
```

---

## 3. Error Responses & Formats

Standard error JSON is returned on validations, business logic limits, and server-side errors:

```json
{
  "success": false,
  "error": {
    "code": "WITHDRAWAL_LIMIT_EXCEEDED",
    "message": "Only one normal withdrawal is allowed every 24 hours"
  }
}
```

### Common HTTP Status Codes Used:
- `200`: Success.
- `201`: Record created.
- `400`: Invalid inputs or parameters.
- `404`: Entity not found.
- `409`: Conflict or duplicate states.
- `422`: Unprocessable entity (e.g., business limit exceeded, insufficient balance).
- `500`: Internal server error (stack trace is hidden in production mode).
