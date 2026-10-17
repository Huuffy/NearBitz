import { Platform } from 'react-native';
export { Colors } from './Colors';

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const Radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const Font = {
  regular: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  heavy: 'Manrope_800ExtraBold',
} as const;

export const Type = {
  caption: { fontFamily: Font.semibold, fontSize: 12, lineHeight: 16 },
  body: { fontFamily: Font.regular, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: Font.bold, fontSize: 14, lineHeight: 20 },
  title: { fontFamily: Font.bold, fontSize: 16, lineHeight: 22 },
  heading: { fontFamily: Font.heavy, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  display: { fontFamily: Font.heavy, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
} as const;

// Tabular figures keep distances and amounts from jittering as they change.
export const Numeric = Platform.select({
  web: { fontVariant: ['tabular-nums'] as any },
  default: { fontVariant: ['tabular-nums'] as any },
});

// react-native-web 0.19 deprecates shadow* props; boxShadow works on web and RN 0.76 new arch.
export const Shadow = {
  sm: { boxShadow: '0 1px 2px rgba(20,32,46,0.10), 0 1px 1px rgba(20,32,46,0.06)' } as any,
  md: { boxShadow: '0 4px 14px rgba(20,32,46,0.14)' } as any,
  lg: { boxShadow: '0 12px 32px rgba(20,32,46,0.20)' } as any,
};
