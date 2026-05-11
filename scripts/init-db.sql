-- Creates separate databases for each service
-- MySQL root runs this once on first startup

CREATE DATABASE IF NOT EXISTS orderdb;
CREATE DATABASE IF NOT EXISTS invoicedb;

-- Grant the orderflow user access to both
GRANT ALL PRIVILEGES ON orderdb.*   TO 'orderflow'@'%';
GRANT ALL PRIVILEGES ON invoicedb.* TO 'orderflow'@'%';

FLUSH PRIVILEGES;
