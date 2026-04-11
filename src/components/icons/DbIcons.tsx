/**
 * Database type SVG icons — high-quality vector icons for each supported database.
 * All icons accept standard SVG props (size, className, etc.)
 *
 * FerrobaseIcon supports a `variant` prop:
 *   - "light" — bright blue gradient background, white DB shapes (for light theme)
 *   - "dark"  — dark slate background, glowing neon DB shapes (for dark theme)
 */

import { useThemeStore } from '../../stores';

interface IconProps {
  size?: number;
  className?: string;
}

// ============ Ferrobase App Icon (theme-aware) ============
export function FerrobaseIcon({ size = 20, className, variant }: IconProps & { variant?: 'light' | 'dark' }) {
  const theme = useThemeStore((s) => s.theme);

  // Auto-detect variant from theme if not explicitly set
  const resolvedVariant = variant ?? (
    theme === 'dark' ? 'dark'
    : theme === 'light' ? 'light'
    : (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );

  if (resolvedVariant === 'dark') {
    return <FerrobaseIconDark size={size} className={className} />;
  }
  return <FerrobaseIconLight size={size} className={className} />;
}

// ---- Light variant: bright blue gradient + white DB ----
function FerrobaseIconLight({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fb-bg-l" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6"/>
          <stop offset="100%" stopColor="#1D4ED8"/>
        </linearGradient>
        <linearGradient id="fb-shine-l" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#fb-bg-l)"/>
      <rect width="64" height="64" rx="14" fill="url(#fb-shine-l)"/>
      <ellipse cx="32" cy="18" rx="17" ry="6" fill="#fff" opacity="0.95"/>
      <path d="M15 18v10c0 3.3 7.6 6 17 6s17-2.7 17-6V18" fill="#fff" opacity="0.2"/>
      <ellipse cx="32" cy="28" rx="17" ry="6" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5"/>
      <path d="M15 28v10c0 3.3 7.6 6 17 6s17-2.7 17-6V28" fill="#fff" opacity="0.2"/>
      <ellipse cx="32" cy="38" rx="17" ry="6" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5"/>
      <path d="M15 38v8c0 3.3 7.6 6 17 6s17-2.7 17-6v-8" fill="#fff" opacity="0.15"/>
      <ellipse cx="32" cy="46" rx="17" ry="6" fill="#fff" opacity="0.95"/>
      <path d="M34 22l-5 8h4l-1 8 6-9h-4.5z" fill="#FBBF24" opacity="0.9"/>
    </svg>
  );
}

// ---- Dark variant: dark slate + glowing blue neon DB + fire bolt ----
function FerrobaseIconDark({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fb-bg-d" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1E293B"/>
          <stop offset="100%" stopColor="#0F172A"/>
        </linearGradient>
        <linearGradient id="fb-glow-d" x1="32" y1="10" x2="32" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA"/>
          <stop offset="100%" stopColor="#3B82F6"/>
        </linearGradient>
        <linearGradient id="fb-bolt-d" x1="30" y1="20" x2="35" y2="45" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F59E0B"/>
          <stop offset="100%" stopColor="#EF4444"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#fb-bg-d)"/>
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="none" stroke="#3B82F6" strokeWidth="0.6" opacity="0.3"/>
      {/* Glowing DB */}
      <ellipse cx="32" cy="17.5" rx="15" ry="5.2" fill="url(#fb-glow-d)" opacity="0.85"/>
      <path d="M17 17.5v8.7c0 2.9 6.7 5.2 15 5.2s15-2.3 15-5.2V17.5" fill="url(#fb-glow-d)" opacity="0.1" stroke="#60A5FA" strokeWidth="0.5"/>
      <ellipse cx="32" cy="26.2" rx="15" ry="5.2" fill="url(#fb-glow-d)" opacity="0.12" stroke="#60A5FA" strokeWidth="0.4"/>
      <path d="M17 26.2v8.7c0 2.9 6.7 5.2 15 5.2s15-2.3 15-5.2V26.2" fill="url(#fb-glow-d)" opacity="0.08" stroke="#60A5FA" strokeWidth="0.5"/>
      <ellipse cx="32" cy="34.9" rx="15" ry="5.2" fill="url(#fb-glow-d)" opacity="0.12" stroke="#60A5FA" strokeWidth="0.4"/>
      <path d="M17 34.9v6.8c0 2.9 6.7 5.2 15 5.2s15-2.3 15-5.2V34.9" fill="url(#fb-glow-d)" opacity="0.08" stroke="#60A5FA" strokeWidth="0.5"/>
      <ellipse cx="32" cy="41.7" rx="15" ry="5.2" fill="url(#fb-glow-d)" opacity="0.85"/>
      {/* Fire bolt */}
      <path d="M34 20.5l-4.5 7.2h3.5l-0.9 7.2 5.6-8.2h-4z" fill="url(#fb-bolt-d)" opacity="0.95"/>
      {/* Fe label */}
      <text x="32" y="54" textAnchor="middle" fill="#94A3B8" fontSize="4.5" fontWeight="700" fontFamily="system-ui" letterSpacing="0.5" opacity="0.5">Fe</text>
    </svg>
  );
}

// ============ Redis (Official logo shape) ============
export function RedisIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30.8 20.2c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2s-7.5-3.1-8.7-3.7c-0.6-0.3-0.9-0.5-0.9-0.8v-2.3s8.5-1.8 9.9-2.4c1.4-0.5 1.9-0.5 3.1 0 1.2 0.5 8.4 1.7 9.6 2.2v2.3c0 0.3-0.2 0.5-1.4 0.7z" fill="#A41E11"/>
      <path d="M30.8 17.5c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2s-7.5-3.1-8.7-3.7c-1.2-0.5-1.2-1 0-1.5 1.2-0.5 7.4-2.9 8.6-3.4 1.2-0.5 1.9-0.5 3.1 0 1.2 0.5 7 2.6 8.2 3.1 1.3 0.5 1.6 1-0.6 1.5z" fill="#D82C20"/>
      <path d="M30.8 15.1c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2s-7.5-3.1-8.7-3.7c-0.6-0.3-0.9-0.5-0.9-0.8v-2.3s8.5-1.8 9.9-2.4c1.4-0.5 1.9-0.5 3.1 0 1.2 0.5 8.4 1.7 9.6 2.2v2.3c0 0.3-0.2 0.5-1.4 0.7z" fill="#A41E11"/>
      <path d="M30.8 12.4c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2s-7.5-3.1-8.7-3.7c-1.2-0.5-1.2-1 0-1.5 1.2-0.5 7.4-2.9 8.6-3.4 1.2-0.5 1.9-0.5 3.1 0 1.2 0.5 7 2.6 8.2 3.1 1.3 0.5 1.6 1-0.6 1.5z" fill="#D82C20"/>
      <path d="M30.8 10c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2s-7.5-3.1-8.7-3.7c-0.6-0.3-0.9-0.5-0.9-0.8V7.2s8.5-1.8 9.9-2.4c1.4-0.5 1.9-0.5 3.1 0C23.8 5.3 31 6.5 32.2 7v2.3c0 0.3-0.2 0.5-1.4 0.7z" fill="#A41E11"/>
      <path d="M30.8 7.3c-1.2 0.6-7.3 3.1-8.6 3.8-1.3 0.7-2 0.7-3 0.2S11.7 8.2 10.5 7.6c-1.2-0.5-1.2-1 0-1.5 1.2-0.5 7.4-2.9 8.6-3.4 1.2-0.5 1.9-0.5 3.1 0 1.2 0.5 7 2.6 8.2 3.1 1.3 0.5 1.6 1-0.6 1.5z" fill="#D82C20"/>
      {/* Star / diamond shape in center */}
      <path d="M21.6 6.2l-2 0.8-2-0.8 2-0.8z" fill="#fff" opacity="0.8"/>
      <path d="M16.2 8.4l-1.6-0.6 4-1.5 2.3 0.9z" fill="#7A0C00"/>
      <path d="M24.6 5.9l-4.7 1.8-2.3-0.9 4-1.5z" fill="#AD2115"/>
    </svg>
  );
}

// ============ MySQL (Dolphin-inspired) ============
export function MySqlIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#00758F"/>
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v4H4V7z" fill="#F29111"/>
      <circle cx="8" cy="9" r="1" fill="white" opacity="0.8"/>
      <circle cx="12" cy="9" r="1" fill="white" opacity="0.8"/>
      <circle cx="16" cy="9" r="1" fill="white" opacity="0.5"/>
      <text x="16" y="22" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="system-ui">SQL</text>
    </svg>
  );
}

// ============ PostgreSQL (Elephant-inspired) ============
export function PostgresIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#336791"/>
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v4H4V7z" fill="#264D73"/>
      <ellipse cx="16" cy="9" rx="3" ry="2.5" fill="white" opacity="0.9"/>
      <path d="M14 9c0.5-0.8 1.5-1.3 2-1.3" stroke="#336791" strokeWidth="0.5" fill="none"/>
      <text x="16" y="22" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="system-ui">PG</text>
    </svg>
  );
}

// ============ MongoDB (Leaf-inspired) ============
export function MongoIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#13AA52"/>
      <path d="M16 6c0 0-3.5 3.5-3.5 8.5 0 4 1.5 7 3.5 9.5 2-2.5 3.5-5.5 3.5-9.5 0-5-3.5-8.5-3.5-8.5z" fill="white" opacity="0.9"/>
      <path d="M16 6v18" stroke="#13AA52" strokeWidth="1" opacity="0.5"/>
    </svg>
  );
}

// ============ SQLite (Lightweight) ============
export function SqliteIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#0F80CC"/>
      <path d="M10 9h12v3H10z" fill="white" opacity="0.3" rx="1"/>
      <path d="M10 14h12v3H10z" fill="white" opacity="0.3" rx="1"/>
      <path d="M10 19h12v3H10z" fill="white" opacity="0.3" rx="1"/>
      <text x="16" y="17.5" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="system-ui">LITE</text>
    </svg>
  );
}

// ============ SQL Server ============
export function SqlServerIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#CC2927"/>
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v4H4V7z" fill="#A02125"/>
      <text x="16" y="21" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="system-ui">MS</text>
    </svg>
  );
}

// ============ ClickHouse ============
export function ClickHouseIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7c0-1.1 0.9-2 2-2h20c1.1 0 2 0.9 2 2v18c0 1.1-0.9 2-2 2H6c-1.1 0-2-0.9-2-2V7z" fill="#FFCC00"/>
      <rect x="9" y="7" width="3" height="18" rx="0.5" fill="#1F1F1F"/>
      <rect x="14.5" y="7" width="3" height="18" rx="0.5" fill="#1F1F1F"/>
      <rect x="20" y="7" width="3" height="18" rx="0.5" fill="#1F1F1F"/>
      <rect x="20" y="12" width="3" height="7" rx="0.5" fill="#EF4444"/>
    </svg>
  );
}

// ============ DbTypeIcon — unified component ============
export function DbTypeIcon({ dbType, size = 16, className }: IconProps & { dbType: string }) {
  switch (dbType) {
    case 'mysql': return <MySqlIcon size={size} className={className} />;
    case 'postgres': return <PostgresIcon size={size} className={className} />;
    case 'sqlite': return <SqliteIcon size={size} className={className} />;
    case 'mongodb': return <MongoIcon size={size} className={className} />;
    case 'redis': return <RedisIcon size={size} className={className} />;
    case 'sqlServer': return <SqlServerIcon size={size} className={className} />;
    case 'clickhouse': return <ClickHouseIcon size={size} className={className} />;
    default: return <GenericDbIcon size={size} className={className} />;
  }
}

// ============ Generic database icon ============
export function GenericDbIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="16" cy="8" rx="10" ry="4" fill="#6B7280"/>
      <path d="M6 8v16c0 2.2 4.5 4 10 4s10-1.8 10-4V8" fill="#4B5563"/>
      <ellipse cx="16" cy="8" rx="10" ry="4" fill="#6B7280"/>
      <ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#9CA3AF" strokeWidth="0.8" opacity="0.5"/>
      <ellipse cx="16" cy="24" rx="10" ry="4" fill="#6B7280"/>
    </svg>
  );
}
