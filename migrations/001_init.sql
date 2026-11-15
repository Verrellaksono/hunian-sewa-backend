-- --- Tabel pengguna (satu tabel, peran via kolom role — bukan inheritance) ---
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  phone         VARCHAR(20),
  role          VARCHAR(20)   NOT NULL CHECK (role IN ('tenant', 'guardian', 'caretaker', 'owner')), 
  guardian_id   BIGINT REFERENCES users(id), -- hanya tenant/penyewa yang boleh punya guardian_id
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

-- Non-tenant tidak boleh punya guardian_id
ALTER TABLE users
  ADD CONSTRAINT users_guardian_only_for_tenant
  CHECK (role = 'tenant' OR guardian_id IS NULL);

-- guardian_id harus merujuk akun berperan guardian (integritas referensial di level DB)
CREATE OR REPLACE FUNCTION enforce_guardian_role() RETURNS trigger AS $$
BEGIN
  IF NEW.guardian_id IS NOT NULL THEN
    IF NEW.role <> 'tenant' OR EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.guardian_id AND u.role <> 'guardian') THEN
      RAISE EXCEPTION 'guardian_id hanya boleh diisi untuk tenant dan merujuk akun guardian';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_guardian_role
  BEFORE INSERT OR UPDATE OF guardian_id, role ON users
  FOR EACH ROW EXECUTE FUNCTION enforce_guardian_role();

-- --- Tabel kamar ---
CREATE TABLE rooms (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_number VARCHAR(20)  NOT NULL UNIQUE,
  room_type   VARCHAR(50)  NOT NULL,
  facilities  TEXT,
  price       NUMERIC(12,0) CHECK (price IS NULL OR price > 0),
  status      VARCHAR(20)  NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- --- Tabel kontrak sewa ---
CREATE TABLE tenancy_contracts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     BIGINT NOT NULL REFERENCES users(id),
  room_id       BIGINT NOT NULL REFERENCES rooms(id),
  start_date    DATE   NOT NULL,
  end_date      DATE,
  monthly_rate  NUMERIC(12,0) NOT NULL CHECK (monthly_rate > 0),
  next_due_date DATE   NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' 
                CHECK (status IN ('pending', 'active', 'completed', 'terminated', 'cancelled')),
  created_by    BIGINT NOT NULL REFERENCES users(id),
  terminated_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- satu kamar & satu penyewa maksimal satu kontrak pending/active
CREATE UNIQUE INDEX contracts_room_unique_active
  ON tenancy_contracts (room_id) WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX contracts_tenant_unique_active
  ON tenancy_contracts (tenant_id) WHERE status IN ('pending', 'active');

-- --- Tabel pengumuman ---
CREATE TABLE announcements (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id    BIGINT NOT NULL REFERENCES users(id),
  title        VARCHAR(150) NOT NULL,
  content      TEXT NOT NULL,
  category     VARCHAR(20) NOT NULL CHECK (category IN ('urgent', 'routine', 'maintenance')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Tabel tiket laporan kerusakan ---
CREATE TABLE issue_tickets (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id    BIGINT NOT NULL REFERENCES tenancy_contracts(id),
  -- Daftar kategori tetap (FR-03)
  category       VARCHAR(50) NOT NULL
                 CHECK (category IN ('Listrik', 'Air', 'Internet', 'AC', 'Furnitur', 'Kebersihan', 'Lainnya')),
  description    TEXT NOT NULL,
  photo_path     VARCHAR(255),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_progress', 'resolved')),
  technical_note TEXT, 
  resolved_at    TIMESTAMPTZ,
  resolved_by    BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Tabel komentar/diskusi tiket ---
CREATE TABLE ticket_comments (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id  BIGINT NOT NULL REFERENCES issue_tickets(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Tabel invoice tagihan bulanan ---
CREATE TABLE invoices (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_number VARCHAR(30) NOT NULL UNIQUE,
  contract_id    BIGINT NOT NULL REFERENCES tenancy_contracts(id),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  due_date       DATE NOT NULL,
  amount         NUMERIC(12,0) NOT NULL CHECK (amount > 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                 CHECK (status IN ('unpaid', 'pending', 'paid', 'cancelled')),
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ
);

-- satu invoice terbuka per periode per kontrak
ALTER TABLE invoices
  ADD CONSTRAINT invoices_contract_period_unique UNIQUE (contract_id, period_start);

CREATE INDEX invoices_contract_idx ON invoices (contract_id);

-- --- Tabel  item invoice ---
CREATE TABLE invoice_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES invoices(id),
  item_type   VARCHAR(20) NOT NULL CHECK (item_type IN ('rent', 'other')),
  description VARCHAR(150) NOT NULL,
  quantity    INT NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12,0) NOT NULL,
  subtotal    NUMERIC(12,0) NOT NULL
);

-- --- Tabel Payment ---
CREATE TABLE payments (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id            BIGINT NOT NULL REFERENCES invoices(id),
  payer_id              BIGINT NOT NULL REFERENCES users(id),
  order_id              VARCHAR(50) NOT NULL UNIQUE,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'settlement', 'expire', 'cancel', 'deny', 'failure')),
  payment_method        VARCHAR(30),
  gateway_transaction_id VARCHAR(64),
  payment_url           TEXT,
  gross_amount          NUMERIC(12,0) NOT NULL CHECK (gross_amount > 0),
  expires_at            TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  gateway_payload       JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hanya satu payment pending per invoice
CREATE UNIQUE INDEX payments_invoice_pending_unique
  ON payments (invoice_id) WHERE status = 'pending';

CREATE INDEX payments_payer_idx ON payments (payer_id);
CREATE INDEX payments_expires_idx ON payments (status, expires_at) WHERE status = 'pending';



-- Trigger updated_at otomatis untuk semua tabel yang memilikinya
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger Update at untuk semua tabel
CREATE TRIGGER trg_users_updated_at      BEFORE UPDATE ON users             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rooms_updated_at      BEFORE UPDATE ON rooms             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contracts_updated_at  BEFORE UPDATE ON tenancy_contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON announcements     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated_at    BEFORE UPDATE ON issue_tickets     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_updated_at   BEFORE UPDATE ON payments          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
