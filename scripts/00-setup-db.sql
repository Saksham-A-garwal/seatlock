-- One-time local dev setup: creates the seatlock database and a dedicated
-- app role (not the postgres superuser) for the backend to connect as.
-- Run this once as the postgres superuser: psql -U postgres -h localhost -f scripts/00-setup-db.sql

CREATE DATABASE seatlock;
CREATE ROLE seatlock_app WITH LOGIN PASSWORD 'ZpXJ_3VIBeow6aPC314EtpP9';
GRANT ALL PRIVILEGES ON DATABASE seatlock TO seatlock_app;

\c seatlock
GRANT ALL ON SCHEMA public TO seatlock_app;
