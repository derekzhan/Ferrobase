/**
 * Monaco SQL Completion Provider — database-type aware
 *
 * Provides intelligent autocomplete that adapts to the connected database type:
 * - MySQL: MySQL-specific keywords, functions, types
 * - PostgreSQL: PG-specific keywords, functions, types
 * - SQLite: SQLite-specific keywords, functions
 * - MongoDB: MongoDB shell syntax hints
 * - Generic SQL for unknown types
 *
 * Also provides:
 * - Database table names (fetched from backend)
 * - Column names for known tables
 * - Context-aware suggestions (table names after FROM/JOIN, columns after SELECT/WHERE)
 */

import type * as Monaco from 'monaco-editor';
import { schemaApi } from '../../api';
import type { TableInfo, ColumnDetail } from '../../types';

// ============ Database-specific definitions ============

const COMMON_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'TABLE', 'DATABASE', 'INDEX', 'VIEW',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'FULL', 'ON', 'USING',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
  'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
  'ALL', 'ANY', 'UNION', 'INTERSECT', 'EXCEPT',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'CHECK', 'DEFAULT',
  'NOT', 'NULL', 'CASCADE', 'RESTRICT',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'EXPLAIN', 'ANALYZE',
  'TRUNCATE', 'RENAME', 'ADD', 'MODIFY', 'COLUMN',
  'WITH', 'RECURSIVE',
  'PARTITION', 'OVER', 'WINDOW', 'ROWS', 'RANGE',
];

const MYSQL_KEYWORDS = [
  ...COMMON_KEYWORDS,
  'USE', 'SHOW', 'DESCRIBE', 'DESC',
  'AUTO_INCREMENT', 'CHANGE', 'REPLACE', 'IGNORE', 'DUPLICATE',
  'ENGINE', 'CHARSET', 'COLLATE', 'CHARACTER',
  'UNSIGNED', 'SIGNED', 'ZEROFILL',
  'TEMPORARY', 'IF', 'PROCEDURE', 'FUNCTION', 'TRIGGER',
  'GRANT', 'REVOKE', 'FLUSH', 'RESET',
  'LOCK', 'UNLOCK', 'TABLES',
  'SAVEPOINT', 'RELEASE',
  'STRAIGHT_JOIN', 'SQL_CALC_FOUND_ROWS', 'HIGH_PRIORITY', 'LOW_PRIORITY',
  'DELAYED', 'FORCE', 'SQL_NO_CACHE',
];

const POSTGRES_KEYWORDS = [
  ...COMMON_KEYWORDS,
  'RETURNING', 'CONFLICT', 'DO', 'NOTHING', 'UPSERT',
  'LATERAL', 'NATURAL', 'FETCH', 'FIRST', 'NEXT', 'ONLY',
  'SCHEMA', 'EXTENSION', 'SEQUENCE', 'MATERIALIZED',
  'ILIKE', 'SIMILAR', 'ARRAY', 'UNNEST',
  'VACUUM', 'REINDEX', 'CLUSTER',
  'NOTIFY', 'LISTEN', 'UNLISTEN',
  'COPY', 'PERFORM', 'RAISE', 'NOTICE', 'EXCEPTION',
  'CONCURRENTLY', 'IF', 'CASCADE',
  'SERIAL', 'BIGSERIAL', 'SMALLSERIAL',
  'GENERATED', 'ALWAYS', 'IDENTITY',
  'TABLESAMPLE', 'BERNOULLI', 'SYSTEM',
  'GRANT', 'REVOKE',
];

const SQLITE_KEYWORDS = [
  ...COMMON_KEYWORDS,
  'AUTOINCREMENT', 'GLOB', 'REPLACE', 'ABORT',
  'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX',
  'INDEXED', 'IMMEDIATE', 'DEFERRED', 'EXCLUSIVE',
  'IF', 'TEMP', 'TEMPORARY', 'WITHOUT', 'ROWID',
];

// ============ Database-specific types ============

const MYSQL_TYPES = [
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR',
  'BOOLEAN', 'BOOL', 'BIT',
  'JSON', 'ENUM', 'SET',
  'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
];

const POSTGRES_TYPES = [
  'INTEGER', 'BIGINT', 'SMALLINT', 'INT', 'INT2', 'INT4', 'INT8',
  'DECIMAL', 'NUMERIC', 'REAL', 'DOUBLE PRECISION', 'FLOAT4', 'FLOAT8',
  'SERIAL', 'BIGSERIAL', 'SMALLSERIAL',
  'MONEY',
  'CHAR', 'VARCHAR', 'TEXT', 'CHARACTER VARYING',
  'BYTEA',
  'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'INTERVAL',
  'BOOLEAN', 'BOOL',
  'UUID',
  'JSON', 'JSONB',
  'XML',
  'INET', 'CIDR', 'MACADDR', 'MACADDR8',
  'ARRAY', 'HSTORE',
  'POINT', 'LINE', 'LSEG', 'BOX', 'PATH', 'POLYGON', 'CIRCLE',
  'TSQUERY', 'TSVECTOR',
  'INT4RANGE', 'INT8RANGE', 'NUMRANGE', 'TSRANGE', 'DATERANGE',
];

const SQLITE_TYPES = [
  'INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC',
  'INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT',
  'CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'CLOB',
  'FLOAT', 'DOUBLE', 'DECIMAL',
  'BOOLEAN', 'DATE', 'DATETIME',
];

// ============ Database-specific functions ============

interface FnDef { name: string; detail: string; insertText: string }

const COMMON_FUNCTIONS: FnDef[] = [
  { name: 'COUNT', detail: 'COUNT(expr) — Count rows', insertText: 'COUNT(${1:*})' },
  { name: 'SUM', detail: 'SUM(expr) — Sum values', insertText: 'SUM(${1:column})' },
  { name: 'AVG', detail: 'AVG(expr) — Average', insertText: 'AVG(${1:column})' },
  { name: 'MIN', detail: 'MIN(expr) — Minimum', insertText: 'MIN(${1:column})' },
  { name: 'MAX', detail: 'MAX(expr) — Maximum', insertText: 'MAX(${1:column})' },
  { name: 'COALESCE', detail: 'COALESCE(val1, val2, ...) — First non-null', insertText: 'COALESCE(${1:val1}, ${2:val2})' },
  { name: 'NULLIF', detail: 'NULLIF(a, b) — Null if equal', insertText: 'NULLIF(${1:a}, ${2:b})' },
  { name: 'CAST', detail: 'CAST(expr AS type)', insertText: 'CAST(${1:expr} AS ${2:type})' },
  { name: 'CONCAT', detail: 'CONCAT(str1, str2)', insertText: 'CONCAT(${1:str1}, ${2:str2})' },
  { name: 'SUBSTRING', detail: 'SUBSTRING(str, pos, len)', insertText: 'SUBSTRING(${1:str}, ${2:1}, ${3:10})' },
  { name: 'LENGTH', detail: 'LENGTH(str)', insertText: 'LENGTH(${1:str})' },
  { name: 'UPPER', detail: 'UPPER(str)', insertText: 'UPPER(${1:str})' },
  { name: 'LOWER', detail: 'LOWER(str)', insertText: 'LOWER(${1:str})' },
  { name: 'TRIM', detail: 'TRIM(str)', insertText: 'TRIM(${1:str})' },
  { name: 'REPLACE', detail: 'REPLACE(str, from, to)', insertText: 'REPLACE(${1:str}, ${2:from}, ${3:to})' },
  { name: 'ABS', detail: 'ABS(n)', insertText: 'ABS(${1:n})' },
  { name: 'ROUND', detail: 'ROUND(n, d)', insertText: 'ROUND(${1:n}, ${2:0})' },
  { name: 'FLOOR', detail: 'FLOOR(n)', insertText: 'FLOOR(${1:n})' },
  { name: 'CEIL', detail: 'CEIL(n)', insertText: 'CEIL(${1:n})' },
  // Window functions
  { name: 'ROW_NUMBER', detail: 'ROW_NUMBER() OVER(...)', insertText: 'ROW_NUMBER() OVER(${1:ORDER BY col})' },
  { name: 'RANK', detail: 'RANK() OVER(...)', insertText: 'RANK() OVER(${1:ORDER BY col})' },
  { name: 'DENSE_RANK', detail: 'DENSE_RANK() OVER(...)', insertText: 'DENSE_RANK() OVER(${1:ORDER BY col})' },
  { name: 'LAG', detail: 'LAG(col, n) OVER(...)', insertText: 'LAG(${1:col}, ${2:1}) OVER(${3:ORDER BY col})' },
  { name: 'LEAD', detail: 'LEAD(col, n) OVER(...)', insertText: 'LEAD(${1:col}, ${2:1}) OVER(${3:ORDER BY col})' },
];

const MYSQL_FUNCTIONS: FnDef[] = [
  ...COMMON_FUNCTIONS,
  { name: 'GROUP_CONCAT', detail: 'GROUP_CONCAT(expr SEPARATOR sep)', insertText: "GROUP_CONCAT(${1:column} SEPARATOR '${2:,}')" },
  { name: 'IFNULL', detail: 'IFNULL(expr, alt)', insertText: 'IFNULL(${1:expr}, ${2:alt})' },
  { name: 'IF', detail: 'IF(cond, then, else)', insertText: 'IF(${1:cond}, ${2:then}, ${3:else})' },
  { name: 'NOW', detail: 'NOW() — Current datetime', insertText: 'NOW()' },
  { name: 'CURDATE', detail: 'CURDATE() — Current date', insertText: 'CURDATE()' },
  { name: 'CURTIME', detail: 'CURTIME() — Current time', insertText: 'CURTIME()' },
  { name: 'DATE_FORMAT', detail: 'DATE_FORMAT(date, format)', insertText: "DATE_FORMAT(${1:date}, '${2:%Y-%m-%d}')" },
  { name: 'STR_TO_DATE', detail: 'STR_TO_DATE(str, format)', insertText: "STR_TO_DATE(${1:str}, '${2:%Y-%m-%d}')" },
  { name: 'DATE_ADD', detail: 'DATE_ADD(date, INTERVAL n unit)', insertText: 'DATE_ADD(${1:date}, INTERVAL ${2:1} ${3:DAY})' },
  { name: 'DATE_SUB', detail: 'DATE_SUB(date, INTERVAL n unit)', insertText: 'DATE_SUB(${1:date}, INTERVAL ${2:1} ${3:DAY})' },
  { name: 'DATEDIFF', detail: 'DATEDIFF(date1, date2)', insertText: 'DATEDIFF(${1:date1}, ${2:date2})' },
  { name: 'TIMESTAMPDIFF', detail: 'TIMESTAMPDIFF(unit, dt1, dt2)', insertText: 'TIMESTAMPDIFF(${1:DAY}, ${2:dt1}, ${3:dt2})' },
  { name: 'UNIX_TIMESTAMP', detail: 'UNIX_TIMESTAMP([date])', insertText: 'UNIX_TIMESTAMP(${1:})' },
  { name: 'FROM_UNIXTIME', detail: 'FROM_UNIXTIME(ts)', insertText: 'FROM_UNIXTIME(${1:ts})' },
  { name: 'CONVERT', detail: 'CONVERT(expr, type)', insertText: 'CONVERT(${1:expr}, ${2:type})' },
  { name: 'CHAR_LENGTH', detail: 'CHAR_LENGTH(str)', insertText: 'CHAR_LENGTH(${1:str})' },
  { name: 'LEFT', detail: 'LEFT(str, len)', insertText: 'LEFT(${1:str}, ${2:len})' },
  { name: 'RIGHT', detail: 'RIGHT(str, len)', insertText: 'RIGHT(${1:str}, ${2:len})' },
  { name: 'LPAD', detail: 'LPAD(str, len, pad)', insertText: 'LPAD(${1:str}, ${2:len}, ${3:pad})' },
  { name: 'RPAD', detail: 'RPAD(str, len, pad)', insertText: 'RPAD(${1:str}, ${2:len}, ${3:pad})' },
  { name: 'LOCATE', detail: 'LOCATE(substr, str)', insertText: 'LOCATE(${1:substr}, ${2:str})' },
  { name: 'REVERSE', detail: 'REVERSE(str)', insertText: 'REVERSE(${1:str})' },
  { name: 'JSON_EXTRACT', detail: 'JSON_EXTRACT(doc, path)', insertText: "JSON_EXTRACT(${1:doc}, '${2:\\$.key}')" },
  { name: 'JSON_UNQUOTE', detail: 'JSON_UNQUOTE(val)', insertText: 'JSON_UNQUOTE(${1:val})' },
  { name: 'JSON_OBJECT', detail: "JSON_OBJECT('key', val)", insertText: "JSON_OBJECT('${1:key}', ${2:val})" },
  { name: 'JSON_ARRAY', detail: 'JSON_ARRAY(val, ...)', insertText: 'JSON_ARRAY(${1:val})' },
  { name: 'FOUND_ROWS', detail: 'FOUND_ROWS() — Rows from last query', insertText: 'FOUND_ROWS()' },
  { name: 'LAST_INSERT_ID', detail: 'LAST_INSERT_ID()', insertText: 'LAST_INSERT_ID()' },
];

const POSTGRES_FUNCTIONS: FnDef[] = [
  ...COMMON_FUNCTIONS,
  { name: 'STRING_AGG', detail: "STRING_AGG(expr, delimiter)", insertText: "STRING_AGG(${1:column}, '${2:,}')" },
  { name: 'ARRAY_AGG', detail: 'ARRAY_AGG(expr)', insertText: 'ARRAY_AGG(${1:column})' },
  { name: 'NOW', detail: 'NOW() — Current timestamp', insertText: 'NOW()' },
  { name: 'CURRENT_DATE', detail: 'CURRENT_DATE', insertText: 'CURRENT_DATE' },
  { name: 'CURRENT_TIME', detail: 'CURRENT_TIME', insertText: 'CURRENT_TIME' },
  { name: 'CURRENT_TIMESTAMP', detail: 'CURRENT_TIMESTAMP', insertText: 'CURRENT_TIMESTAMP' },
  { name: 'AGE', detail: 'AGE(ts1, ts2) — Interval between', insertText: 'AGE(${1:ts1}, ${2:ts2})' },
  { name: 'DATE_TRUNC', detail: "DATE_TRUNC('field', source)", insertText: "DATE_TRUNC('${1:day}', ${2:ts})" },
  { name: 'EXTRACT', detail: 'EXTRACT(field FROM source)', insertText: 'EXTRACT(${1:YEAR} FROM ${2:ts})' },
  { name: 'TO_CHAR', detail: "TO_CHAR(val, format)", insertText: "TO_CHAR(${1:val}, '${2:YYYY-MM-DD}')" },
  { name: 'TO_DATE', detail: "TO_DATE(str, format)", insertText: "TO_DATE(${1:str}, '${2:YYYY-MM-DD}')" },
  { name: 'TO_TIMESTAMP', detail: "TO_TIMESTAMP(str, format)", insertText: "TO_TIMESTAMP(${1:str}, '${2:YYYY-MM-DD HH24:MI:SS}')" },
  { name: 'GENERATE_SERIES', detail: 'GENERATE_SERIES(start, stop, step)', insertText: 'GENERATE_SERIES(${1:1}, ${2:10}, ${3:1})' },
  { name: 'REGEXP_REPLACE', detail: 'REGEXP_REPLACE(str, pattern, replace)', insertText: "REGEXP_REPLACE(${1:str}, '${2:pattern}', '${3:replace}')" },
  { name: 'REGEXP_MATCHES', detail: 'REGEXP_MATCHES(str, pattern)', insertText: "REGEXP_MATCHES(${1:str}, '${2:pattern}')" },
  { name: 'JSONB_BUILD_OBJECT', detail: "JSONB_BUILD_OBJECT('key', val)", insertText: "JSONB_BUILD_OBJECT('${1:key}', ${2:val})" },
  { name: 'JSONB_AGG', detail: 'JSONB_AGG(expr)', insertText: 'JSONB_AGG(${1:expr})' },
  { name: 'JSONB_EXTRACT_PATH_TEXT', detail: 'JSONB_EXTRACT_PATH_TEXT(json, key)', insertText: "JSONB_EXTRACT_PATH_TEXT(${1:json}, '${2:key}')" },
  { name: 'PG_SLEEP', detail: 'PG_SLEEP(seconds)', insertText: 'PG_SLEEP(${1:1})' },
  { name: 'CURRVAL', detail: "CURRVAL('sequence')", insertText: "CURRVAL('${1:seq}')" },
  { name: 'NEXTVAL', detail: "NEXTVAL('sequence')", insertText: "NEXTVAL('${1:seq}')" },
  { name: 'SETVAL', detail: "SETVAL('sequence', value)", insertText: "SETVAL('${1:seq}', ${2:1})" },
];

const SQLITE_FUNCTIONS: FnDef[] = [
  ...COMMON_FUNCTIONS,
  { name: 'GROUP_CONCAT', detail: 'GROUP_CONCAT(expr, sep)', insertText: "GROUP_CONCAT(${1:column}, '${2:,}')" },
  { name: 'IFNULL', detail: 'IFNULL(expr, alt)', insertText: 'IFNULL(${1:expr}, ${2:alt})' },
  { name: 'TYPEOF', detail: 'TYPEOF(expr) — Value type', insertText: 'TYPEOF(${1:expr})' },
  { name: 'DATETIME', detail: "DATETIME('now')", insertText: "DATETIME('${1:now}')" },
  { name: 'DATE', detail: "DATE('now')", insertText: "DATE('${1:now}')" },
  { name: 'TIME', detail: "TIME('now')", insertText: "TIME('${1:now}')" },
  { name: 'STRFTIME', detail: "STRFTIME(format, date)", insertText: "STRFTIME('${1:%Y-%m-%d}', ${2:date})" },
  { name: 'JULIANDAY', detail: 'JULIANDAY(date)', insertText: 'JULIANDAY(${1:date})' },
  { name: 'TOTAL', detail: 'TOTAL(expr) — Always returns float', insertText: 'TOTAL(${1:column})' },
  { name: 'INSTR', detail: 'INSTR(str, substr)', insertText: 'INSTR(${1:str}, ${2:substr})' },
  { name: 'UNICODE', detail: 'UNICODE(str)', insertText: 'UNICODE(${1:str})' },
  { name: 'ZEROBLOB', detail: 'ZEROBLOB(n)', insertText: 'ZEROBLOB(${1:n})' },
  { name: 'LAST_INSERT_ROWID', detail: 'LAST_INSERT_ROWID()', insertText: 'LAST_INSERT_ROWID()' },
  { name: 'CHANGES', detail: 'CHANGES() — Rows changed', insertText: 'CHANGES()' },
  { name: 'TOTAL_CHANGES', detail: 'TOTAL_CHANGES()', insertText: 'TOTAL_CHANGES()' },
  { name: 'SQLITE_VERSION', detail: 'SQLITE_VERSION()', insertText: 'SQLITE_VERSION()' },
  { name: 'JSON_EXTRACT', detail: "JSON_EXTRACT(json, path)", insertText: "JSON_EXTRACT(${1:json}, '${2:\\$.key}')" },
  { name: 'JSON_ARRAY', detail: 'JSON_ARRAY(val, ...)', insertText: 'JSON_ARRAY(${1:val})' },
  { name: 'JSON_OBJECT', detail: "JSON_OBJECT('key', val)", insertText: "JSON_OBJECT('${1:key}', ${2:val})" },
];

// MongoDB shell-style suggestions
const MONGODB_SNIPPETS = [
  { label: 'db.collection.find', detail: 'Query documents', insertText: 'db.${1:collection}.find({${2:}}).limit(${3:100})' },
  { label: 'db.collection.findOne', detail: 'Query single document', insertText: 'db.${1:collection}.findOne({${2:}})' },
  { label: 'db.collection.insertOne', detail: 'Insert one document', insertText: 'db.${1:collection}.insertOne({${2:}})' },
  { label: 'db.collection.insertMany', detail: 'Insert multiple documents', insertText: 'db.${1:collection}.insertMany([{${2:}}])' },
  { label: 'db.collection.updateOne', detail: 'Update one document', insertText: 'db.${1:collection}.updateOne({${2:filter}}, {\\$set: {${3:}}})' },
  { label: 'db.collection.updateMany', detail: 'Update multiple documents', insertText: 'db.${1:collection}.updateMany({${2:filter}}, {\\$set: {${3:}}})' },
  { label: 'db.collection.deleteOne', detail: 'Delete one document', insertText: 'db.${1:collection}.deleteOne({${2:filter}})' },
  { label: 'db.collection.deleteMany', detail: 'Delete multiple documents', insertText: 'db.${1:collection}.deleteMany({${2:filter}})' },
  { label: 'db.collection.aggregate', detail: 'Aggregation pipeline', insertText: 'db.${1:collection}.aggregate([{\\$match: {${2:}}}])' },
  { label: 'db.collection.countDocuments', detail: 'Count documents', insertText: 'db.${1:collection}.countDocuments({${2:}})' },
  { label: 'db.collection.createIndex', detail: 'Create index', insertText: 'db.${1:collection}.createIndex({${2:field}: 1})' },
  { label: 'db.collection.distinct', detail: 'Get distinct values', insertText: "db.${1:collection}.distinct('${2:field}')" },
];

const MONGODB_COLLECTION_METHODS = [
  { label: 'find', detail: 'Find documents', insertText: 'find({${1:}}).limit(${2:100})' },
  { label: 'findOne', detail: 'Find a single document', insertText: 'findOne({${1:}})' },
  { label: 'aggregate', detail: 'Aggregation pipeline', insertText: 'aggregate([{\n  \\$match: { ${1:field}: ${2:value} }\n}])' },
  { label: 'sort', detail: 'Sort documents', insertText: 'sort({ ${1:field}: ${2:-1} })' },
  { label: 'project', detail: 'Project fields', insertText: 'project({ ${1:field}: 1 })' },
  { label: 'limit', detail: 'Limit result count', insertText: 'limit(${1:100})' },
  { label: 'skip', detail: 'Skip result count', insertText: 'skip(${1:0})' },
  { label: 'countDocuments', detail: 'Count matching documents', insertText: 'countDocuments({${1:}})' },
  { label: 'distinct', detail: 'Distinct values for a field', insertText: "distinct('${1:field}', {${2:}})" },
  { label: 'insertOne', detail: 'Insert one document', insertText: 'insertOne({${1:}})' },
  { label: 'updateOne', detail: 'Update one document', insertText: 'updateOne({${1:filter}}, {\\$set: { ${2:field}: ${3:value} }})' },
];

const MONGODB_OPERATORS = [
  '$match', '$group', '$sort', '$limit', '$skip', '$project', '$unwind',
  '$lookup', '$addFields', '$set', '$unset', '$replaceRoot', '$merge', '$out',
  '$count', '$facet', '$bucket', '$bucketAuto', '$sortByCount',
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$and', '$or', '$not', '$nor', '$exists', '$type', '$regex',
  '$push', '$addToSet', '$inc', '$min', '$max', '$mul', '$rename',
  '$sum', '$avg', '$first', '$last',
];

const MONGODB_GLOBALS = [
  { label: 'db', detail: 'Current database handle' },
  { label: 'ObjectId', detail: 'Create an ObjectId' },
  { label: 'ISODate', detail: 'Create an ISO date value' },
  { label: 'NumberLong', detail: 'Create a 64-bit integer' },
  { label: 'true', detail: 'Boolean true' },
  { label: 'false', detail: 'Boolean false' },
  { label: 'null', detail: 'Null value' },
];

// ============ Get definitions by DB type ============

function getKeywords(dbType?: string): string[] {
  switch (dbType) {
    case 'mysql': return MYSQL_KEYWORDS;
    case 'postgres': return POSTGRES_KEYWORDS;
    case 'sqlite': return SQLITE_KEYWORDS;
    default: return MYSQL_KEYWORDS; // Default to MySQL as it's the most common
  }
}

function getTypes(dbType?: string): string[] {
  switch (dbType) {
    case 'mysql': return MYSQL_TYPES;
    case 'postgres': return POSTGRES_TYPES;
    case 'sqlite': return SQLITE_TYPES;
    default: return MYSQL_TYPES;
  }
}

function getFunctions(dbType?: string): FnDef[] {
  switch (dbType) {
    case 'mysql': return MYSQL_FUNCTIONS;
    case 'postgres': return POSTGRES_FUNCTIONS;
    case 'sqlite': return SQLITE_FUNCTIONS;
    default: return MYSQL_FUNCTIONS;
  }
}

// ============ SQL Snippets (adapt to DB type) ============

function getSnippets(dbType?: string) {
  if (dbType === 'mongodb') return MONGODB_SNIPPETS;

  const autoInc = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' :
                  dbType === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' :
                  'BIGINT AUTO_INCREMENT PRIMARY KEY';

  return [
    { label: 'SELECT ... FROM', detail: 'Basic SELECT query', insertText: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:1=1}\nLIMIT ${4:100};' },
    { label: 'SELECT COUNT', detail: 'Count query', insertText: 'SELECT COUNT(*) AS cnt\nFROM ${1:table}\nWHERE ${2:1=1};' },
    { label: 'INSERT INTO', detail: 'Insert statement', insertText: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});' },
    { label: 'UPDATE ... SET', detail: 'Update statement', insertText: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};' },
    { label: 'DELETE FROM', detail: 'Delete statement', insertText: 'DELETE FROM ${1:table}\nWHERE ${2:condition};' },
    { label: 'CREATE TABLE', detail: 'Create table', insertText: `CREATE TABLE \${1:table_name} (\n  id ${autoInc},\n  \${2:column} \${3:VARCHAR(255)} NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);` },
    { label: 'ALTER TABLE ADD', detail: 'Add column', insertText: 'ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3:VARCHAR(255)};' },
    { label: 'CREATE INDEX', detail: 'Create index', insertText: 'CREATE INDEX ${1:idx_name}\nON ${2:table} (${3:column});' },
    { label: 'LEFT JOIN', detail: 'Left join', insertText: 'LEFT JOIN ${1:table} ON ${2:t1.id} = ${3:t2.id}' },
    { label: 'INNER JOIN', detail: 'Inner join', insertText: 'INNER JOIN ${1:table} ON ${2:t1.id} = ${3:t2.id}' },
    { label: 'GROUP BY ... HAVING', detail: 'Group by with having', insertText: 'GROUP BY ${1:column}\nHAVING ${2:COUNT(*) > 1}' },
    { label: 'CASE WHEN', detail: 'Case expression', insertText: "CASE\n  WHEN ${1:condition} THEN ${2:'value1'}\n  ELSE ${3:'value2'}\nEND" },
    { label: 'WITH CTE', detail: 'Common table expression', insertText: 'WITH ${1:cte_name} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n  WHERE ${4:1=1}\n)\nSELECT * FROM ${1:cte_name};' },
  ];
}

// ============ Schema Cache ============
interface SchemaCache {
  connectionId: string;
  database: string;
  tables: TableInfo[];
  columns: Record<string, ColumnDetail[]>;
  lastFetched: number;
}

let schemaCache: SchemaCache | null = null;
const CACHE_TTL = 60000;

async function ensureSchemaLoaded(connectionId?: string, database?: string): Promise<SchemaCache | null> {
  if (!connectionId || !database) return null;

  const now = Date.now();
  if (
    schemaCache &&
    schemaCache.connectionId === connectionId &&
    schemaCache.database === database &&
    now - schemaCache.lastFetched < CACHE_TTL
  ) {
    return schemaCache;
  }

  try {
    const tables = await schemaApi.getTables(connectionId, database);
    schemaCache = {
      connectionId,
      database,
      tables,
      columns: schemaCache?.connectionId === connectionId ? schemaCache.columns : {},
      lastFetched: now,
    };
    return schemaCache;
  } catch {
    return schemaCache;
  }
}

async function ensureColumnsLoaded(
  connectionId: string,
  database: string,
  tableName: string,
): Promise<ColumnDetail[]> {
  const cache = await ensureSchemaLoaded(connectionId, database);
  if (!cache) return [];

  if (cache.columns[tableName]) return cache.columns[tableName];

  try {
    const cols = await schemaApi.getTableColumns(connectionId, database, tableName);
    cache.columns[tableName] = cols;
    return cols;
  } catch {
    return [];
  }
}

// ============ Context Detection ============

const TABLE_CONTEXT_KEYWORDS = /\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|CROSS\s+JOIN|FULL\s+JOIN|INTO|UPDATE|TABLE|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|DESCRIBE|DESC|EXPLAIN)\s+$/i;
const COLUMN_CONTEXT_KEYWORDS = /\b(SELECT|WHERE|AND|OR|ON|SET|BY|HAVING|GROUP\s+BY|ORDER\s+BY)\s+$/i;
const TABLE_DOT_PATTERN = /(\w+)\.\s*$/;

function getTextBeforeCursor(model: Monaco.editor.ITextModel, position: Monaco.Position): string {
  const lineContent = model.getLineContent(position.lineNumber);
  const textBefore = lineContent.substring(0, position.column - 1);
  const startLine = Math.max(1, position.lineNumber - 5);
  let fullContext = '';
  for (let i = startLine; i < position.lineNumber; i++) {
    fullContext += model.getLineContent(i) + ' ';
  }
  fullContext += textBefore;
  return fullContext;
}

function extractMongoCollectionName(text: string): string | undefined {
  const matches = [...text.matchAll(/db\.([A-Za-z_]\w*)/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : undefined;
}

function isMongoCollectionRootContext(text: string): boolean {
  return /db\.\s*$/.test(text);
}

function isMongoMethodContext(text: string): boolean {
  return /db\.[A-Za-z_]\w*\.\s*$/.test(text);
}

function isMongoFieldContext(text: string): boolean {
  return /(?:find|findOne|sort|project|distinct|countDocuments)\([^)]*$/.test(text) ||
    /\$(?:match|group|sort|project|set|unset|addFields):\s*\{[^}]*$/.test(text);
}

function isMongoOperatorContext(text: string): boolean {
  return /\$[\w]*$/.test(text) || /aggregate\(\s*\[[\s\S]*\{[\s\S]*$/.test(text);
}

function makeCompletionItem(
  monacoInstance: typeof Monaco,
  range: Monaco.IRange,
  label: string,
  detail: string,
  insertText: string,
  kind: Monaco.languages.CompletionItemKind,
  sortText: string,
  asSnippet = false,
): Monaco.languages.CompletionItem {
  return {
    label,
    kind,
    detail,
    insertText,
    range,
    sortText,
    insertTextRules: asSnippet
      ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
  };
}

// ============ Create Provider ============

export function createSqlCompletionProvider(
  monacoInstance: typeof Monaco,
  getConnectionId: () => string | undefined,
  getDatabase: () => string | undefined,
  getDbType: () => string | undefined,
): Monaco.IDisposable {
  const provideCompletionItems: Monaco.languages.CompletionItemProvider['provideCompletionItems'] = async (model, position) => {
    const connectionId = getConnectionId();
    const database = getDatabase();
    const dbType = getDbType();
    const textBeforeCursor = getTextBeforeCursor(model, position);
    const word = model.getWordUntilPosition(position);
    const range: Monaco.IRange = {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    };

    const suggestions: Monaco.languages.CompletionItem[] = [];

    // MongoDB special handling
    if (dbType === 'mongodb') {
      const activeCollection = extractMongoCollectionName(textBeforeCursor);

      for (const global of MONGODB_GLOBALS) {
        suggestions.push(
          makeCompletionItem(
            monacoInstance,
            range,
            global.label,
            global.detail,
            global.label,
            monacoInstance.languages.CompletionItemKind.Keyword,
            `0-${global.label}`,
          )
        );
      }

      if (isMongoCollectionRootContext(textBeforeCursor) && connectionId && database) {
        const cache = await ensureSchemaLoaded(connectionId, database);
        if (cache) {
          for (const table of cache.tables) {
            suggestions.push(
              makeCompletionItem(
                monacoInstance,
                range,
                table.name,
                'Collection',
                table.name,
                monacoInstance.languages.CompletionItemKind.Struct,
                `0-${table.name}`,
              )
            );
          }
        }
      }

      if (isMongoMethodContext(textBeforeCursor)) {
        for (const method of MONGODB_COLLECTION_METHODS) {
          suggestions.push(
            makeCompletionItem(
              monacoInstance,
              range,
              method.label,
              method.detail,
              method.insertText,
              monacoInstance.languages.CompletionItemKind.Method,
              `1-${method.label}`,
              true,
            )
          );
        }
      }

      if (activeCollection && connectionId && database && isMongoFieldContext(textBeforeCursor)) {
        const fields = await ensureColumnsLoaded(connectionId, database, activeCollection);
        for (const field of fields) {
          suggestions.push(
            makeCompletionItem(
              monacoInstance,
              range,
              field.name,
              `${field.columnType} (${activeCollection})`,
              field.name,
              monacoInstance.languages.CompletionItemKind.Field,
              field.isPrimaryKey ? `0-${field.name}` : `2-${field.name}`,
            )
          );
        }
      }

      if (isMongoOperatorContext(textBeforeCursor)) {
        for (const op of MONGODB_OPERATORS) {
          suggestions.push(
            makeCompletionItem(
              monacoInstance,
              range,
              op,
              'MongoDB operator',
              op,
              monacoInstance.languages.CompletionItemKind.Keyword,
              `1-${op}`,
            )
          );
        }
      }

      if (connectionId && database) {
        const cache = await ensureSchemaLoaded(connectionId, database);
        if (cache) {
          for (const table of cache.tables) {
            if (!suggestions.find((item) => item.label === table.name)) {
              suggestions.push(
                makeCompletionItem(
                  monacoInstance,
                  range,
                  table.name,
                  'Collection',
                  table.name,
                  monacoInstance.languages.CompletionItemKind.Struct,
                  `3-${table.name}`,
                )
              );
            }
          }
        }
      }

      for (const snip of MONGODB_SNIPPETS) {
        suggestions.push(
          makeCompletionItem(
            monacoInstance,
            range,
            snip.label,
            snip.detail,
            snip.insertText,
            monacoInstance.languages.CompletionItemKind.Snippet,
            `4-${snip.label}`,
            true,
          )
        );
      }

      return { suggestions };
    }

    // SQL databases (MySQL, PostgreSQL, SQLite)
    // 1. Check for "table." pattern → suggest columns
    const dotMatch = textBeforeCursor.match(TABLE_DOT_PATTERN);
    if (dotMatch && connectionId && database) {
      const tableName = dotMatch[1];
      const dotRange: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      const cols = await ensureColumnsLoaded(connectionId, database, tableName);
      for (const col of cols) {
        suggestions.push({
          label: col.name,
          kind: monacoInstance.languages.CompletionItemKind.Field,
          detail: `${col.columnType}${col.isPrimaryKey ? ' PK' : ''}${col.nullable ? '' : ' NOT NULL'}`,
          documentation: col.comment || undefined,
          insertText: col.name,
          range: dotRange,
          sortText: col.isPrimaryKey ? '0' + col.name : '1' + col.name,
        });
      }
      if (suggestions.length > 0) {
        suggestions.unshift({
          label: '*',
          kind: monacoInstance.languages.CompletionItemKind.Constant,
          detail: 'All columns',
          insertText: '*',
          range: dotRange,
          sortText: '00',
        });
        return { suggestions };
      }
    }

    // 2. Table context
    const isTableContext = TABLE_CONTEXT_KEYWORDS.test(textBeforeCursor);
    if (isTableContext && connectionId && database) {
      const cache = await ensureSchemaLoaded(connectionId, database);
      if (cache) {
        for (const table of cache.tables) {
          suggestions.push({
            label: table.name,
            kind: table.tableType === 'View'
              ? monacoInstance.languages.CompletionItemKind.Interface
              : monacoInstance.languages.CompletionItemKind.Struct,
            detail: table.tableType === 'View' ? 'View' : 'Table',
            insertText: table.name,
            range,
            sortText: '0' + table.name,
          });
        }
      }
    }

    // 3. Column context
    const isColumnContext = COLUMN_CONTEXT_KEYWORDS.test(textBeforeCursor);
    if (isColumnContext && connectionId && database) {
      const fullText = model.getValue();
      const referencedTables = extractReferencedTables(fullText);
      const cache = await ensureSchemaLoaded(connectionId, database);

      if (cache) {
        for (const table of cache.tables) {
          if (referencedTables.has(table.name.toLowerCase())) {
            suggestions.push({
              label: table.name,
              kind: monacoInstance.languages.CompletionItemKind.Struct,
              detail: 'Table',
              insertText: table.name,
              range,
              sortText: '1' + table.name,
            });
          }
        }

        for (const tName of referencedTables) {
          const actualTable = cache.tables.find(t => t.name.toLowerCase() === tName);
          if (!actualTable) continue;
          const cols = await ensureColumnsLoaded(connectionId, database, actualTable.name);
          for (const col of cols) {
            const prefix = referencedTables.size > 1 ? `${actualTable.name}.` : '';
            suggestions.push({
              label: referencedTables.size > 1 ? `${actualTable.name}.${col.name}` : col.name,
              kind: monacoInstance.languages.CompletionItemKind.Field,
              detail: `${col.columnType}${col.isPrimaryKey ? ' PK' : ''} (${actualTable.name})`,
              documentation: col.comment || undefined,
              insertText: `${prefix}${col.name}`,
              range,
              sortText: '0' + col.name,
            });
          }
        }
      }
    }

    // 4. Keywords (db-type specific)
    const hasSchemaSuggestions = suggestions.length > 0;
    const keywords = getKeywords(dbType);
    for (const kw of keywords) {
      suggestions.push({
        label: kw,
        kind: monacoInstance.languages.CompletionItemKind.Keyword,
        detail: `Keyword (${dbType || 'SQL'})`,
        insertText: kw,
        range,
        sortText: hasSchemaSuggestions ? '3' + kw : '1' + kw,
      });
    }

    // 5. Data types (db-type specific)
    const types = getTypes(dbType);
    for (const t of types) {
      suggestions.push({
        label: t,
        kind: monacoInstance.languages.CompletionItemKind.TypeParameter,
        detail: `Type (${dbType || 'SQL'})`,
        insertText: t,
        range,
        sortText: '4' + t,
      });
    }

    // 6. Functions (db-type specific)
    const functions = getFunctions(dbType);
    for (const fn of functions) {
      suggestions.push({
        label: fn.name,
        kind: monacoInstance.languages.CompletionItemKind.Function,
        detail: fn.detail,
        insertText: fn.insertText,
        insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: hasSchemaSuggestions ? '2' + fn.name : '0' + fn.name,
      });
    }

    // 7. Snippets (db-type specific)
    const snippets = getSnippets(dbType);
    for (const snip of snippets) {
      suggestions.push({
        label: snip.label,
        kind: monacoInstance.languages.CompletionItemKind.Snippet,
        detail: snip.detail,
        insertText: snip.insertText,
        insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: '5' + snip.label,
      });
    }

    // 8. Table names always (lower priority)
    if (!isTableContext && connectionId && database) {
      const cache = await ensureSchemaLoaded(connectionId, database);
      if (cache) {
        for (const table of cache.tables) {
          if (!suggestions.find(s => s.label === table.name && s.kind === monacoInstance.languages.CompletionItemKind.Struct)) {
            suggestions.push({
              label: table.name,
              kind: monacoInstance.languages.CompletionItemKind.Struct,
              detail: table.tableType === 'View' ? 'View' : 'Table',
              insertText: table.name,
              range,
              sortText: '2' + table.name,
            });
          }
        }
      }
    }

    return { suggestions };
  };

  const sqlProvider = monacoInstance.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '\n', '$'],
    provideCompletionItems,
  });

  const mongoProvider = monacoInstance.languages.registerCompletionItemProvider('mongodb', {
    triggerCharacters: ['.', ' ', '\n', '$', ':'],
    provideCompletionItems,
  });

  return {
    dispose() {
      sqlProvider.dispose();
      mongoProvider.dispose();
    },
  };
}

/** Extract table names referenced in FROM / JOIN clauses */
function extractReferencedTables(sql: string): Set<string> {
  const tables = new Set<string>();
  const pattern = /\b(?:FROM|JOIN)\s+(\w+)/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const name = match[1].toLowerCase();
    if (!['select', 'where', 'set', 'values', '('].includes(name)) {
      tables.add(name);
    }
  }
  return tables;
}

/** Force refresh the schema cache */
export function invalidateSchemaCache() {
  schemaCache = null;
}
