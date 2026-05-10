import { createTheme } from '@mui/material/styles'

// Material 3 inspired tokens.
// Primary palette derived from M3 baseline (Indigo-ish source) with light/dark schemes.
const m3 = {
  light: {
    primary: '#4F46E5',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E0E7FF',
    onPrimaryContainer: '#1E1B4B',
    secondary: '#5B5D72',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#E1E0F9',
    onSecondaryContainer: '#181B2C',
    tertiary: '#77536C',
    tertiaryContainer: '#FFD7F0',
    error: '#BA1A1A',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    background: '#FBF8FF',
    onBackground: '#1B1B21',
    surface: '#FBF8FF',
    surfaceDim: '#DBD9E0',
    surfaceContainerLow: '#F5F2FA',
    surfaceContainer: '#EFEDF4',
    surfaceContainerHigh: '#E9E7EF',
    surfaceContainerHighest: '#E4E1E9',
    onSurface: '#1B1B21',
    onSurfaceVariant: '#46464F',
    outline: '#777680',
    outlineVariant: '#C7C5D0',
    success: '#2E7D32',
    warning: '#B26A00',
  },
  dark: {
    primary: '#BFC2FF',
    onPrimary: '#252478',
    primaryContainer: '#3D3D90',
    onPrimaryContainer: '#E0E0FF',
    secondary: '#C5C4DD',
    onSecondary: '#2D2F42',
    secondaryContainer: '#444559',
    onSecondaryContainer: '#E1E0F9',
    tertiary: '#E7B9D5',
    tertiaryContainer: '#5D3C54',
    error: '#FFB4AB',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',
    background: '#131318',
    onBackground: '#E4E1E9',
    surface: '#131318',
    surfaceDim: '#131318',
    surfaceContainerLow: '#1B1B21',
    surfaceContainer: '#1F1F25',
    surfaceContainerHigh: '#2A292F',
    surfaceContainerHighest: '#35343A',
    onSurface: '#E4E1E9',
    onSurfaceVariant: '#C7C5D0',
    outline: '#91909A',
    outlineVariant: '#46464F',
    success: '#7DD884',
    warning: '#FFB951',
  },
} as const

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: m3.light.primary, contrastText: m3.light.onPrimary },
        secondary: { main: m3.light.secondary, contrastText: m3.light.onSecondary },
        error: { main: m3.light.error },
        success: { main: m3.light.success },
        warning: { main: m3.light.warning },
        background: { default: m3.light.background, paper: m3.light.surfaceContainerLow },
        text: { primary: m3.light.onSurface, secondary: m3.light.onSurfaceVariant },
        divider: m3.light.outlineVariant,
      },
    },
    dark: {
      palette: {
        primary: { main: m3.dark.primary, contrastText: m3.dark.onPrimary },
        secondary: { main: m3.dark.secondary, contrastText: m3.dark.onSecondary },
        error: { main: m3.dark.error },
        success: { main: m3.dark.success },
        warning: { main: m3.dark.warning },
        background: { default: m3.dark.background, paper: m3.dark.surfaceContainerLow },
        text: { primary: m3.dark.onSurface, secondary: m3.dark.onSurfaceVariant },
        divider: m3.dark.outlineVariant,
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '"Roboto Flex", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif',
    // M3 type scale (subset)
    h1: { fontSize: '3.5rem', fontWeight: 400, letterSpacing: '-0.015em' },
    h2: { fontSize: '2.25rem', fontWeight: 400 },
    h3: { fontSize: '1.75rem', fontWeight: 500 },
    h4: { fontSize: '1.5rem', fontWeight: 500 },
    h5: { fontSize: '1.25rem', fontWeight: 500 },
    h6: { fontSize: '1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: '0.01em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 20, minHeight: 40 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        // M3 surfaces are flat; override default shadows on Paper variants we use.
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0, variant: 'elevation' },
      styleOverrides: {
        root: {
          backgroundColor: 'var(--mui-palette-background-paper)',
          border: '1px solid var(--mui-palette-divider)',
          borderRadius: 16,
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500 } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          '&.Mui-selected': {
            backgroundColor: 'rgba(var(--mui-palette-primary-mainChannel) / 0.14)',
            '&:hover': { backgroundColor: 'rgba(var(--mui-palette-primary-mainChannel) / 0.2)' },
          },
        },
      },
    },
  },
})

export const statusColor = (status: string) => {
  switch (status) {
    case 'running': return 'primary'
    case 'paused': return 'warning'
    case 'done': return 'success'
    case 'error': return 'error'
    case 'cancelled': return 'default'
    default: return 'default'
  }
}
