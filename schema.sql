CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     BIGINT UNIQUE NOT NULL,
  nome            TEXT,
  username        TEXT,
  utm_source      TEXT,
  utm_campaign    TEXT,
  utm_content     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_telegram_id_idx ON leads (telegram_id);

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  gateway_id      TEXT,
  valor           NUMERIC(10,2) NOT NULL,
  plano           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  pix_copia_cola  TEXT,
  pix_qr_base64   TEXT,
  utm_source      TEXT,
  utm_campaign    TEXT,
  paid_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_lead_id_idx ON transactions (lead_id);
CREATE INDEX IF NOT EXISTS transactions_gateway_id_idx ON transactions (gateway_id);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  transaction_id  UUID REFERENCES transactions(id),
  plano           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  group_id        BIGINT NOT NULL,
  starts_at       TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_lead_id_idx ON subscriptions (lead_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);
CREATE INDEX IF NOT EXISTS subscriptions_expires_at_idx ON subscriptions (expires_at);

ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;
