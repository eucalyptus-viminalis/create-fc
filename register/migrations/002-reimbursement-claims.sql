-- 002, for a register made before Part IV (pnpm db:migrate:002 / db:migrate:002:remote). Run it once.
-- Part IV of the form claims the $5 server reimbursement: where the node is, and an EVM address to pay.
ALTER TABLE members ADD COLUMN node TEXT;
ALTER TABLE members ADD COLUMN payout TEXT;
