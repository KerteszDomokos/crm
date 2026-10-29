ALTER TABLE person_addresses
  ADD COLUMN country_name text;

ALTER TABLE company_addresses
  ADD COLUMN country_name text;

COMMENT ON COLUMN person_addresses.country_name IS
  'Raw/display country label complements ISO country_code and preserves legacy import values.';

COMMENT ON COLUMN company_addresses.country_name IS
  'Raw/display country label complements ISO country_code and preserves legacy import values.';
