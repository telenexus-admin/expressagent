\set ON_ERROR_STOP on

REVOKE CONNECT, TEMPORARY ON DATABASE nexa_billing FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE nexa_billing TO nexa_app;

REVOKE CONNECT, TEMPORARY ON DATABASE radius FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE radius TO radius;

ALTER ROLE nexa_app IN DATABASE nexa_billing SET statement_timeout = '30s';
ALTER ROLE nexa_app IN DATABASE nexa_billing SET lock_timeout = '5s';
ALTER ROLE nexa_app IN DATABASE nexa_billing SET idle_in_transaction_session_timeout = '30s';

ALTER ROLE radius IN DATABASE radius SET statement_timeout = '15s';
ALTER ROLE radius IN DATABASE radius SET lock_timeout = '5s';
ALTER ROLE radius IN DATABASE radius SET idle_in_transaction_session_timeout = '30s';

\connect nexa_billing
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

\connect radius
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
