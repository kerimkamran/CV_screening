-- 0002 audit trail: append-only, hash-chained (§13.5, §18.6, IAM-05, WORK-05 foundation).
--
-- Tamper evidence: each row stores prev_hash (the previous row's hash) and its own hash over
-- the row content plus prev_hash. Chain order is the monotonically increasing `seq`.
-- Append-only: UPDATE, DELETE and TRUNCATE are rejected by triggers, so the guarantee holds
-- even for the table owner. (Superusers can still disable triggers; the periodic export to
-- object-locked storage in GOV-09 is the control for that residual risk.)
--
-- Deviation from §13.5: the plan sketches PARTITION BY RANGE (occurred_at). Partitioning is
-- deferred until volume warrants it (see docs/adr/0008); it can be introduced by migration
-- without changing this table's contract.

CREATE TABLE audit_event (
  -- Assigned by the chain trigger AFTER the advisory lock is held, so seq order == chain order
  -- even under concurrent writers. (An identity column would be allocated before the lock.)
  seq          BIGINT PRIMARY KEY,
  id           ulid NOT NULL UNIQUE,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     ulid NOT NULL,                       -- IAM-05: write rejected if unresolved
  actor_type   actor_kind NOT NULL,
  actor_role   TEXT,
  source_ip    INET,
  action       TEXT NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type  TEXT NOT NULL CHECK (length(btrim(entity_type)) > 0),
  -- Stable ID, deliberately NOT a foreign key: candidate rows are purged on the retention
  -- schedule (DOC-09) while the audit record of decisions about them outlives the data.
  entity_id    ulid NOT NULL,
  before       JSONB,
  after        JSONB,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);
CREATE INDEX audit_event_entity_idx ON audit_event (entity_type, entity_id, seq);
CREATE INDEX audit_event_actor_idx  ON audit_event (actor_id, seq);
CREATE INDEX audit_event_time_idx   ON audit_event (occurred_at);

CREATE SEQUENCE audit_event_seq_seq OWNED BY audit_event.seq;

-- Genesis prev_hash is 64 zeros.
CREATE FUNCTION audit_event_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_hash TEXT;
BEGIN
  -- Serialise appends so the chain has no forks under concurrency. Held until commit.
  PERFORM pg_advisory_xact_lock(hashtext('audit_event_chain'));
  NEW.seq := nextval('audit_event_seq_seq');
  SELECT hash INTO last_hash FROM audit_event ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.hash := encode(sha256(convert_to(
    NEW.prev_hash || '|' || NEW.id || '|' || to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    || '|' || NEW.actor_id || '|' || NEW.actor_type::text || '|' || NEW.action
    || '|' || NEW.entity_type || '|' || NEW.entity_id
    || '|' || COALESCE(NEW.before::text, '') || '|' || COALESCE(NEW.after::text, ''),
    'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_event_chain_bi
  BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

CREATE FUNCTION audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP USING ERRCODE = '55000';
END $$;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

-- Verification helper used by the governance export (RPT-08) and the CI round-trip test.
-- Returns the first seq whose stored hash or link does not match a recomputation, or NULL if intact.
CREATE FUNCTION audit_event_verify_chain() RETURNS BIGINT LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
  expected_prev TEXT := repeat('0', 64);
  expected_hash TEXT;
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY seq LOOP
    IF r.prev_hash <> expected_prev THEN
      RETURN r.seq;
    END IF;
    expected_hash := encode(sha256(convert_to(
      r.prev_hash || '|' || r.id || '|' || to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || r.actor_id || '|' || r.actor_type::text || '|' || r.action
      || '|' || r.entity_type || '|' || r.entity_id
      || '|' || COALESCE(r.before::text, '') || '|' || COALESCE(r.after::text, ''),
      'UTF8')), 'hex');
    IF r.hash <> expected_hash THEN
      RETURN r.seq;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
