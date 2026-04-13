function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKey(value: unknown, key: string): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length === 1 && key in value;
}

export function isMongoExtendedJsonScalar(value: unknown): boolean {
  return (
    hasOnlyKey(value, '$oid') ||
    hasOnlyKey(value, '$date') ||
    hasOnlyKey(value, '$numberLong') ||
    hasOnlyKey(value, '$numberInt') ||
    hasOnlyKey(value, '$numberDouble') ||
    hasOnlyKey(value, '$numberDecimal') ||
    hasOnlyKey(value, '$timestamp')
  );
}

function extractMongoScalarValue(value: unknown): unknown {
  if (hasOnlyKey(value, '$oid')) return value.$oid;
  if (hasOnlyKey(value, '$numberLong')) return value.$numberLong;
  if (hasOnlyKey(value, '$numberInt')) return value.$numberInt;
  if (hasOnlyKey(value, '$numberDouble')) return value.$numberDouble;
  if (hasOnlyKey(value, '$numberDecimal')) return value.$numberDecimal;
  if (hasOnlyKey(value, '$timestamp')) return JSON.stringify(value.$timestamp);
  if (hasOnlyKey(value, '$date')) {
    const raw = value.$date;
    if (typeof raw === 'string') return raw;
    if (hasOnlyKey(raw, '$numberLong')) {
      const millis = Number(raw.$numberLong);
      if (!Number.isNaN(millis)) return new Date(millis).toISOString();
    }
    return JSON.stringify(raw);
  }
  return value;
}

export function formatMongoValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (isMongoExtendedJsonScalar(value)) {
    const raw = extractMongoScalarValue(value);
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  return JSON.stringify(value);
}

export function shouldUseMongoJsonEditor(value: unknown, dataType: string): boolean {
  if (dataType === 'json') return true;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  if (isPlainObject(value) && !isMongoExtendedJsonScalar(value)) return true;
  return false;
}

export function parseMongoInputValue(input: string, dataType: string): unknown {
  const trimmed = input.trim();
  if (!trimmed || trimmed.toUpperCase() === 'NULL') return null;

  switch (dataType) {
    case 'bool':
      if (trimmed === '1') return true;
      if (trimmed === '0') return false;
      return trimmed.toLowerCase() === 'true';
    case 'int':
      return Number.parseInt(trimmed, 10);
    case 'long':
      return { $numberLong: trimmed };
    case 'double': {
      const parsed = Number.parseFloat(trimmed);
      return Number.isNaN(parsed) ? trimmed : parsed;
    }
    case 'decimal':
      return { $numberDecimal: trimmed };
    case 'objectId': {
      const matched = trimmed.match(/^ObjectId\(["']?([0-9a-fA-F]{24})["']?\)$/);
      const raw = matched?.[1] ?? trimmed;
      return { $oid: raw };
    }
    case 'date': {
      const matched = trimmed.match(/^ISODate\(["']?(.+?)["']?\)$/);
      const raw = matched?.[1] ?? trimmed;
      if (/^\d+$/.test(raw)) return { $date: { $numberLong: raw } };
      return { $date: raw };
    }
    case 'json':
      return JSON.parse(trimmed);
    default:
      return trimmed;
  }
}
