-- One-time local dev setup: creates the seatlock database and a dedicated
-- app role (not the postgres superuser) for the backend to connect as.
-- Run this once as the postgres superuser: psql -U postgres -h localhost -f scripts/00-setup-db.sql
--
-- Replace <CHOOSE_A_PASSWORD> below with a password of your own, and use
-- that same value in DATABASE_URL in your .env -- never commit the real one.

CREATE DATABASE seatlock;
CREATE ROLE seatlock_app WITH LOGIN PASSWORD '<CHOOSE_A_PASSWORD>';
GRANT ALL PRIVILEGES ON DATABASE seatlock TO seatlock_app;

\c seatlock
GRANT ALL ON SCHEMA public TO seatlock_app;
