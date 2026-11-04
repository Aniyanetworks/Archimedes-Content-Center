import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = ['#eef2ff', '#dde5ff', '#b8c8fd', '#90a8fa', '#6e8df7', '#5079f5', '#2f5bea', '#2449c9', '#1c3aa3', '#142b7a'];

// Blue-tinted greys so dark mode matches the navy sidebar. Index 7 is the card surface.
const dark: MantineColorsTuple = ['#d5dbe6', '#b1bacb', '#8591a6', '#5f6b82', '#3a4559', '#2a3446', '#1c2636', '#151e2c', '#0f1723', '#0a101a'];

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  colors: { brand, dark },
  defaultRadius: 'md',
  fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily: '"Manrope Variable", "Inter Variable", -apple-system, "Segoe UI", sans-serif',
    fontWeight: '700',
    sizes: { h2: { fontSize: '1.625rem', lineHeight: '1.25' }, h4: { fontSize: '1rem', lineHeight: '1.4' } },
  },
  components: {
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 2 } } },
    Alert: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { radius: 'xl' } },
    Table: { defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md' } },
  },
});
