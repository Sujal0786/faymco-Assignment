# User Payout Management System for Affiliate Sales

A professional, interview-defendable affiliate payout management system designed with Node.js, Express, and PostgreSQL using Knex.js as the query builder. It handles automatic advance commission transfers, administrator reconciliations, manual user withdrawals, and payment recovery with double-entry ledger bookkeeping.

---

## 1. Problem Statement & Key Business Rules

Every affiliate sale initially enters the system with the status `pending`.

1. **Advance Payouts**:
   - Every pending sale is eligible for an advance payout of **10% of its earnings**.
   - An automatic advance payout job runs to calculate and transfer this amount.
   - Once successfully transferred, a sale **must never** receive another advance payout, even if the job runs multiple times or in parallel.
2. **Reconciliation**:
   - An administrator reconciles the sale, updating its status to `approved` or `rejected`.
   - **Approved Sale**: Remaining commission is credited to the wallet (`earnings - successfullyPaidAdvance`).
   - **Rejected Sale**: The advance payout was unentitled and must be collected back, creating a negative adjustment (`-successfullyPaidAdvance`) that debits the user's wallet (which can go negative).
3. **Withdrawals**:
   - Users can manually withdraw positive withdrawable balances.
   - Restricts users to **one manual withdrawal request every 24 hours**.
   - **Failed Payout Recovery**: If a withdrawal payout fails, is cancelled, or is rejected, the reserved funds are restored to the user's wallet. The user can perform an immediate **retry** for the failed amount (bypassing the 24-hour frequency check) by referencing the original failed request.

---

## 2. Walkthrough: The ₹120 Business Case (Expected Total = ₹68)

The test suite contains an automated integration test proving this exact business scenario:

1. **Initial State**:
   - User has 3 pending sales of ₹40 each.
   - Earning per sale = 4000 paise. Total earnings = 12000 paise (₹120).
2. **Advance Payout**:
   - Advance payout job runs. Each sale receives an advance payout of 10%, which is **₹4 (400 paise)**.
   - Total advance paid = ₹12. The sales track `advance_paid_amount = 400`.
3. **Reconciliation**:
   - **Sale 1 is rejected**: Wallet adjustment = `-₹4 (-400 paise)`.
   - **Sale 2 is approved**: Wallet adjustment = `₹40 - ₹4 = +₹36 (+3600 paise)`.
   - **Sale 3 is approved**: Wallet adjustment = `₹40 - ₹4 = +₹36 (+3600 paise)`.
4. **Final Wallet Balance**:
   - Final reconciliation payout / remaining withdrawable amount = **₹68** (6800 paise: calculated as `-400 + 3600 + 3600`).
   - Previously transferred advance = **₹12** (1200 paise: ₹4 per sale).
   - Total lifetime cash received = **₹80** (8000 paise: matching 10% of rejected ₹40 + 100% of approved ₹40 + 100% of approved ₹40).

---

## 3. Technology Stack & Directory Structure

- **Core**: JavaScript, Node.js (v20+), Express.js
- **Database**: PostgreSQL (v15+), Knex.js (SQL query builder & migrations)
- **Tests**: Jest, Supertest
- **Quality**: ESLint, Prettier

```text
├── docs/                      # Detailed Low-Level System Design
│   ├── low-level-design.md
│   ├── database-design.md
│   ├── api-documentation.md
│   ├── assumptions-and-tradeoffs.md
│   └── failure-handling.md
├── src/
│   ├── controllers/           # Request parsers and HTTP responders
│   ├── database/              # Knex database connection, migrations & seeds
│   ├── middleware/            # Request validators & centralized error handler
│   ├── routes/                # Express API router
│   ├── services/              # Pure domain services (Wallet, Payout, etc.)
│   ├── utils/                 # Money conversions and validations
│   └── app.js & server.js     # Express app and boot script
├── tests/
│   ├── integration/           # API and workflow integration tests
│   └── unit/                  # Money and math utility unit tests
├── package.json
└── knexfile.js
```

---

## 4. Setup & Running Instructions

### 4.1 Prerequisites
Ensure you have **Node.js** and a running **PostgreSQL** instance on port 5432.

### 4.2 Installation
1. Install dependencies:
   ```bash
   npm install
   ```

### 4.3 Environment Variables
Configure the database username and password in the `.env` file at the project root:
```env
PORT=3000
NODE_ENV=development
DB_CLIENT=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=faym_payout_db
DB_TEST_NAME=faym_payout_test_db
```

### 4.4 Database Initialization
If the PostgreSQL databases do not exist, create them in Postgres:
```sql
CREATE DATABASE faym_payout_db;
CREATE DATABASE faym_payout_test_db;
```

Then run the Knex migrations and seed initial data:
```bash
# Run migrations on development database
npm run db:migrate

# Seed development database with initial users and sales
npm run db:seed
```

### 4.5 Start the Application
To start the API server in development mode:
```bash
npm run dev
```
To start the API server in production mode:
```bash
npm start
```

### 4.6 Running Tests & Coverage
Run the unit and integration test suite:
```bash
npm test
```
To run tests and output the code coverage report:
```bash
npm run test:coverage
```

### 4.7 Linting & Formatting
To run linter checks:
```bash
npm run lint
```
To automatically format the source files using Prettier:
```bash
npm run format
```

---

## 5. API Usage & cURL Examples

Here are some standard cURL scripts to demonstrate the core APIs:

### 5.1 Create a New User
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"username": "intern_dev", "email": "intern@example.com"}'
```

### 5.2 Record a Sale (Earning: ₹50.00)
```bash
curl -X POST http://localhost:3000/api/sales \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "replace-with-user-uuid",
    "brandId": "replace-with-brand-uuid",
    "externalReference": "ext_ref_999",
    "earning": "50.00"
  }'
```

### 5.3 Run the Advance Payout Job
```bash
curl -X POST http://localhost:3000/api/admin/advance-payouts/run \
  -H "Content-Type: application/json" \
  -d '{"simulateStatus": "success"}'
```

### 5.4 Reconcile a Sale (Approved)
```bash
curl -X POST http://localhost:3000/api/admin/sales/replace-with-sale-uuid/reconcile \
  -H "Content-Type: application/json" \
  -d '{"status": "approved", "adminId": "admin_1"}'
```

### 5.5 Request a Wallet Withdrawal (₹30.00)
```bash
curl -X POST http://localhost:3000/api/users/replace-with-user-uuid/withdrawals \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-withdrawal-uuid-key-1" \
  -d '{"amount": "30.00"}'
```

### 5.6 Simulate Payout Provider Webhook (Payout Failure)
```bash
curl -X POST http://localhost:3000/api/webhooks/payout-provider \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_callback_102",
    "eventType": "payout.failed",
    "payoutId": "replace-with-withdrawal-uuid",
    "providerReference": "prov_mockref123",
    "failureReason": "Beneficiary bank account closed"
  }'
```

---

## 6. Detailed System Documentation

For in-depth discussions on system design, database configurations, and recovery workflows, refer to the documentation:

1. [Low-Level System Design Document](docs/low-level-design.md)
2. [Database Schema & Constraints](docs/database-design.md)
3. [Complete API Specifications](docs/api-documentation.md)
4. [Assumptions & Business Trade-offs](docs/assumptions-and-tradeoffs.md)
5. [Failure Recovery & Integrity Safeguards](docs/failure-handling.md)
