ALTER TABLE ufds_o_smartdc ALTER COLUMN 'objectclass' SET DATA TYPE 'text[]';
ALTER TABLE ufds_o_smartdc ALTER COLUMN 'pwdhistory' SET DATA TYPE 'text[]';
ALTER TABLE ufds_o_smartdc ALTER COLUMN 'pwdfailuretime' SET DATA TYPE 'numeric[]';

DROP INDEX ufds_o_smartdc_objectclass_idx;
DROP INDEX ufds_o_smartdc_pwdfailuretime_idx;
DROP INDEX ufds_o_smartdc_pwdhistory_idx;

CREATE INDEX ufds_o_smartdc_objectclass_idx ON ufds_o_smartdc USING gin ('objectclass') WHERE ('objectclass' IS NOT NULL);
CREATE INDEX ufds_o_smartdc_pwdfailuretime_idx ON ufds_o_smartdc USING gin ('pwdfailuretime') WHERE ('pwdfailuretime' IS NOT NULL);
CREATE INDEX ufds_o_smartdc_pwdhistory_idx ON ufds_o_smartdc USING gin ('pwdhistory') WHERE ('pwdhistory' IS NOT NULL);

REINDEX INDEX ufds_o_smartdc_objectclass_idx;
REINDEX INDEX ufds_o_smartdc_pwdfailuretime_idx;
REINDEX INDEX ufds_o_smartdc_pwdhistory_idx;
