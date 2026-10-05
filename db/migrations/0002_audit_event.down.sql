DROP FUNCTION IF EXISTS audit_event_verify_chain();
DROP TRIGGER IF EXISTS audit_event_no_truncate ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_update_delete ON audit_event;
DROP TRIGGER IF EXISTS audit_event_chain_bi ON audit_event;
DROP TABLE IF EXISTS audit_event;
DROP SEQUENCE IF EXISTS audit_event_seq_seq;
DROP FUNCTION IF EXISTS audit_event_immutable();
DROP FUNCTION IF EXISTS audit_event_chain();
