// Candidate color directions for the design system, reviewed on /ui-kit.
// `current` mirrors today's tokens in src/index.css for comparison; the new
// directions keep the brand amber (#F5A524) from the Azzanco logo.

export interface PaletteTokens {
  bg: string
  fg: string
  muted: string
  border: string
  surface: string
  surfaceHover: string
  primary: string
  primaryHover: string
  primaryContrast: string
  /** Primary used as text, links, and focus rings on bg/surface. */
  primaryText: string
  accent: string
  accentContrast: string
  sidebar: string
  sidebarFg: string
  sidebarMuted: string
  sidebarActive: string
  sidebarActiveFg: string
  entry: string
  entrySoft: string
  exit: string
  exitSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  info: string
  infoSoft: string
}

export interface PaletteDirection {
  id: 'current' | 'brand' | 'industrial' | 'indigo'
  name: string
  summary: string
  light: PaletteTokens
  dark: PaletteTokens
}

export const PALETTE_DIRECTIONS: PaletteDirection[] = [
  {
    id: 'current',
    name: 'الالوان الحالية',
    summary:
      'الوان الموقع الحالي كما هي: اسود وابيض مع الوان وظيفية للدخول والخروج. للمقارنة مع الاتجاهات الجديدة.',
    light: {
      bg: '#FFFFFF',
      fg: '#0A0A0A',
      muted: '#6B7280',
      border: '#E5E7EB',
      surface: '#F9FAFB',
      surfaceHover: '#F3F4F6',
      primary: '#0A0A0A',
      primaryHover: '#262626',
      primaryContrast: '#FFFFFF',
      primaryText: '#0A0A0A',
      accent: '#0A0A0A',
      accentContrast: '#FFFFFF',
      sidebar: '#FFFFFF',
      sidebarFg: '#0A0A0A',
      sidebarMuted: '#6B7280',
      sidebarActive: '#0A0A0A',
      sidebarActiveFg: '#FFFFFF',
      entry: '#15803D',
      entrySoft: '#ECFDF3',
      exit: '#B45309',
      exitSoft: '#FFF7ED',
      warning: '#B45309',
      warningSoft: '#FFF7ED',
      danger: '#DC2626',
      dangerSoft: '#FEF2F2',
      info: '#0369A1',
      infoSoft: '#F0F9FF',
    },
    dark: {
      bg: '#1A1A1A',
      fg: '#F5F5F5',
      muted: '#A8ADB7',
      border: '#424242',
      surface: '#242424',
      surfaceHover: '#303030',
      primary: '#F5F5F5',
      primaryHover: '#D4D4D4',
      primaryContrast: '#0A0A0A',
      primaryText: '#F5F5F5',
      accent: '#F5F5F5',
      accentContrast: '#0A0A0A',
      sidebar: '#1A1A1A',
      sidebarFg: '#F5F5F5',
      sidebarMuted: '#A8ADB7',
      sidebarActive: '#F5F5F5',
      sidebarActiveFg: '#0A0A0A',
      entry: '#4ADE80',
      entrySoft: '#13271B',
      exit: '#FBBF24',
      exitSoft: '#2B2112',
      warning: '#FBBF24',
      warningSoft: '#2B2112',
      danger: '#F87171',
      dangerSoft: '#2A1414',
      info: '#7DD3FC',
      infoSoft: '#0C1F2C',
    },
  },
  {
    id: 'brand',
    name: 'هوية ازانكو',
    summary:
      'الكهرماني والفحمي من الشعار. الازرار الرئيسية كهرمانية والقائمة فحمية، والخروج ازرق حتى لا يختلط بلون الهوية.',
    light: {
      bg: '#FFFFFF',
      fg: '#1F2123',
      muted: '#67635C',
      border: '#E7E2DA',
      surface: '#FAF8F5',
      surfaceHover: '#F3EEE6',
      primary: '#F5A524',
      primaryHover: '#E3940C',
      primaryContrast: '#1C1D1F',
      primaryText: '#8F5300',
      accent: '#2B2D30',
      accentContrast: '#FFFFFF',
      sidebar: '#26282B',
      sidebarFg: '#F4F1EC',
      sidebarMuted: '#A8A39B',
      sidebarActive: '#F5A524',
      sidebarActiveFg: '#1C1D1F',
      entry: '#15803D',
      entrySoft: '#EAF7EE',
      exit: '#1D4ED8',
      exitSoft: '#EAF0FE',
      warning: '#B45309',
      warningSoft: '#FFF6E5',
      danger: '#C81E1E',
      dangerSoft: '#FEF1F1',
      info: '#0369A1',
      infoSoft: '#E8F4FB',
    },
    dark: {
      bg: '#17181A',
      fg: '#F3F1ED',
      muted: '#A7A39C',
      border: '#34373B',
      surface: '#1F2124',
      surfaceHover: '#2A2C30',
      primary: '#F5A524',
      primaryHover: '#FFB840',
      primaryContrast: '#1C1D1F',
      primaryText: '#F5A524',
      accent: '#F3F1ED',
      accentContrast: '#17181A',
      sidebar: '#111213',
      sidebarFg: '#F3F1ED',
      sidebarMuted: '#8F8B85',
      sidebarActive: '#F5A524',
      sidebarActiveFg: '#1C1D1F',
      entry: '#4ADE80',
      entrySoft: '#12291B',
      exit: '#8AB0FF',
      exitSoft: '#17223D',
      warning: '#FBBF24',
      warningSoft: '#2B2112',
      danger: '#F87171',
      dangerSoft: '#2E1616',
      info: '#38BDF8',
      infoSoft: '#0F2533',
    },
  },
  {
    id: 'industrial',
    name: 'ازرق صناعي',
    summary:
      'ازرق عميق للازرار وقائمة كحلية، والكهرماني لمسات للتمييز. طابع رسمي وواضح لبيئة تشغيل.',
    light: {
      bg: '#FFFFFF',
      fg: '#0F172A',
      muted: '#586377',
      border: '#DFE5EF',
      surface: '#F5F7FB',
      surfaceHover: '#EBF0F8',
      primary: '#1D4ED8',
      primaryHover: '#1E40AF',
      primaryContrast: '#FFFFFF',
      primaryText: '#1D4ED8',
      accent: '#F5A524',
      accentContrast: '#1C1D1F',
      sidebar: '#0F1E3D',
      sidebarFg: '#E6ECF7',
      sidebarMuted: '#8C9BBA',
      sidebarActive: '#1D4ED8',
      sidebarActiveFg: '#FFFFFF',
      entry: '#15803D',
      entrySoft: '#EAF7EE',
      exit: '#C2410C',
      exitSoft: '#FFF1E8',
      warning: '#B45309',
      warningSoft: '#FFF6E5',
      danger: '#C81E1E',
      dangerSoft: '#FEF1F1',
      info: '#0E7490',
      infoSoft: '#E6F6F9',
    },
    dark: {
      bg: '#0B1220',
      fg: '#E8EEF9',
      muted: '#95A1B8',
      border: '#243049',
      surface: '#111A2C',
      surfaceHover: '#18233A',
      primary: '#6B97FF',
      primaryHover: '#89ACFF',
      primaryContrast: '#0B1220',
      primaryText: '#6B97FF',
      accent: '#F5A524',
      accentContrast: '#1C1D1F',
      sidebar: '#070D18',
      sidebarFg: '#E8EEF9',
      sidebarMuted: '#7F8BA3',
      sidebarActive: '#6B97FF',
      sidebarActiveFg: '#0B1220',
      entry: '#4ADE80',
      entrySoft: '#12291B',
      exit: '#FB923C',
      exitSoft: '#2D1B10',
      warning: '#FBBF24',
      warningSoft: '#2B2112',
      danger: '#F87171',
      dangerSoft: '#2E1616',
      info: '#22D3EE',
      infoSoft: '#0C2830',
    },
  },
  {
    id: 'indigo',
    name: 'نيلي حيوي',
    summary:
      'نيلي عصري للازرار مع الكهرماني، وقائمة فاتحة. الاكثر حيوية، ومناسب لتطبيق يستخدم كثير على الجوال.',
    light: {
      bg: '#FFFFFF',
      fg: '#16152B',
      muted: '#605F7D',
      border: '#E3E3F0',
      surface: '#F7F7FC',
      surfaceHover: '#EEEEF9',
      primary: '#4F46E5',
      primaryHover: '#4338CA',
      primaryContrast: '#FFFFFF',
      primaryText: '#4F46E5',
      accent: '#F5A524',
      accentContrast: '#1C1D1F',
      sidebar: '#F7F7FC',
      sidebarFg: '#16152B',
      sidebarMuted: '#605F7D',
      sidebarActive: '#4F46E5',
      sidebarActiveFg: '#FFFFFF',
      entry: '#15803D',
      entrySoft: '#EAF7EE',
      exit: '#C2410C',
      exitSoft: '#FFF1E8',
      warning: '#B45309',
      warningSoft: '#FFF6E5',
      danger: '#C81E1E',
      dangerSoft: '#FEF1F1',
      info: '#0369A1',
      infoSoft: '#E8F4FB',
    },
    dark: {
      bg: '#0F0F1A',
      fg: '#ECEBFA',
      muted: '#9D9CB8',
      border: '#2C2C45',
      surface: '#171728',
      surfaceHover: '#202036',
      primary: '#8F89FF',
      primaryHover: '#A8A3FF',
      primaryContrast: '#0F0F1A',
      primaryText: '#8F89FF',
      accent: '#F5A524',
      accentContrast: '#1C1D1F',
      sidebar: '#0B0B14',
      sidebarFg: '#ECEBFA',
      sidebarMuted: '#8584A3',
      sidebarActive: '#8F89FF',
      sidebarActiveFg: '#0F0F1A',
      entry: '#4ADE80',
      entrySoft: '#12291B',
      exit: '#FB923C',
      exitSoft: '#2D1B10',
      warning: '#FBBF24',
      warningSoft: '#2B2112',
      danger: '#F87171',
      dangerSoft: '#2E1616',
      info: '#38BDF8',
      infoSoft: '#0F2533',
    },
  },
]

function channel(value: number) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) =>
    channel(parseInt(hex.slice(i, i + 2), 16)),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}
