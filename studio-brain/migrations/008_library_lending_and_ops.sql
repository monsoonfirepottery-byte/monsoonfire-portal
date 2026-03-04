CREATE TABLE IF NOT EXISTS borrow_transactions (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  item_id bigint NOT NULL REFERENCES library_items(id),
  borrower_id bigint NOT NULL REFERENCES users(id),
  state text NOT NULL
    CHECK (state IN ('checked_out', 'returned', 'overdue', 'lost', 'replacement_paid')),
  checked_out_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL CHECK (due_at > checked_out_at),
  checked_in_at timestamptz NULL,
  suggested_donation_cents integer NULL CHECK (suggested_donation_cents >= 0),
  replacement_value_snapshot_cents integer NULL CHECK (replacement_value_snapshot_cents >= 0),
  lost_marked_at timestamptz NULL,
  lost_marked_by bigint NULL REFERENCES users(id),
  replacement_charge_status text NULL
    CHECK (replacement_charge_status IN (
      'pending_admin_confirmation',
      'pending_payment',
      'paid',
      'waived',
      'failed'
    )),
  stripe_payment_intent_id text NULL,
  admin_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS donations (
  id bigserial PRIMARY KEY,
  borrow_transaction_id bigint NULL REFERENCES borrow_transactions(id),
  user_id bigint NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  stripe_payment_intent_id text NULL,
  stripe_charge_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS library_item_stats (
  item_id bigint PRIMARY KEY REFERENCES library_items(id),
  avg_rating numeric(3, 2) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  borrow_count integer NOT NULL DEFAULT 0,
  last_borrowed_at timestamptz NULL,
  last_reviewed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id bigint NULL REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text NULL,
  before_json jsonb NULL,
  after_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_borrow_transactions_one_active_per_item
  ON borrow_transactions (item_id)
  WHERE state IN ('checked_out', 'overdue', 'lost') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_borrow_transactions_borrower_state_checked_out
  ON borrow_transactions (borrower_id, state, checked_out_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_transactions_item_state_due
  ON borrow_transactions (item_id, state, due_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created_at
  ON audit_log (entity_type, entity_id, created_at DESC);
