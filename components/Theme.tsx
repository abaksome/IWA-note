import React, { createContext, useState, useEffect, useContext, useMemo } from 'react';

type ThemeName = 'dark' | 'light' | 'blue';

interface Theme {
  name: ThemeName;
  colors: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    textPrimary: string;
    textSecondary: string;
    textHeader: string;
    textAccent: string;
    textAccentHover: string;
    textAccentGradient: string;
    accent: string;
    accentHover: string;
    accentFocusRing: string;
    secondaryAccent: string;
    secondaryAccentHover: string;
    border: string;
    placeholder: string;
    buttonDisabled: string;
    dangerText: string;
    dangerTextHover: string;
    successText: string;
    warnText: string;
    iconAccent: string;
    iconSecondary: string;
  };
}

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    colors: {
      bgPrimary: 'bg-slate-900',
      bgSecondary: 'bg-slate-800',
      bgTertiary: 'bg-slate-700',
      textPrimary: 'text-white',
      textSecondary: 'text-slate-400',
      textHeader: 'text-slate-200',
      textAccent: 'text-indigo-400',
      textAccentHover: 'hover:text-indigo-300',
      textAccentGradient: 'from-indigo-400 to-purple-500',
      accent: 'bg-indigo-600',
      accentHover: 'hover:bg-indigo-700',
      accentFocusRing: 'focus:ring-indigo-500',
      secondaryAccent: 'bg-purple-600',
      secondaryAccentHover: 'hover:bg-purple-700',
      border: 'border-slate-700',
      placeholder: 'placeholder-slate-500',
      buttonDisabled: 'disabled:bg-slate-600 disabled:cursor-not-allowed',
      dangerText: 'text-red-400',
      dangerTextHover: 'hover:text-red-500',
      successText: 'text-green-400',
      warnText: 'text-amber-400',
      iconAccent: 'text-indigo-400',
      iconSecondary: 'text-slate-400',
    }
  },
  light: {
    name: 'light',
    colors: {
      bgPrimary: 'bg-gray-100',
      bgSecondary: 'bg-white',
      bgTertiary: 'bg-gray-200',
      textPrimary: 'text-gray-900',
      textSecondary: 'text-gray-500',
      textHeader: 'text-gray-800',
      textAccent: 'text-blue-600',
      textAccentHover: 'hover:text-blue-500',
      textAccentGradient: 'from-blue-600 to-teal-500',
      accent: 'bg-blue-600',
      accentHover: 'hover:bg-blue-700',
      accentFocusRing: 'focus:ring-blue-500',
      secondaryAccent: 'bg-teal-500',
      secondaryAccentHover: 'hover:bg-teal-600',
      border: 'border-gray-300',
      placeholder: 'placeholder-gray-400',
      buttonDisabled: 'disabled:bg-gray-300 disabled:cursor-not-allowed',
      dangerText: 'text-red-500',
      dangerTextHover: 'hover:text-red-600',
      successText: 'text-green-600',
      warnText: 'text-orange-500',
      iconAccent: 'text-blue-600',
      iconSecondary: 'text-gray-500',
    }
  },
   blue: {
    name: 'blue',
    colors: {
      bgPrimary: 'bg-blue-950',
      bgSecondary: 'bg-blue-900',
      bgTertiary: 'bg-blue-800',
      textPrimary: 'text-white',
      textSecondary: 'text-blue-300',
      textHeader: 'text-blue-100',
      textAccent: 'text-sky-400',
      textAccentHover: 'hover:text-sky-300',
      textAccentGradient: 'from-sky-400 to-cyan-400',
      accent: 'bg-sky-600',
      accentHover: 'hover:bg-sky-700',
      accentFocusRing: 'focus:ring-sky-500',
      secondaryAccent: 'bg-cyan-600',
      secondaryAccentHover: 'hover:bg-cyan-700',
      border: 'border-blue-800',
      placeholder: 'placeholder-blue-400',
      buttonDisabled: 'disabled:bg-blue-700 disabled:cursor-not-allowed',
      dangerText: 'text-rose-400',
      dangerTextHover: 'hover:text-rose-500',
      successText: 'text-teal-300',
      warnText: 'text-yellow-300',
      iconAccent: 'text-sky-400',
      iconSecondary: 'text-blue-300',
    }
  }
};

interface ThemeContextType {
  theme: Theme;
  setTheme: (name: ThemeName) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeName, setThemeName] = useState<ThemeName>('dark');

  useEffect(() => {
    const storedTheme = localStorage.getItem('iwa-theme') as ThemeName | null;
    if (storedTheme && themes[storedTheme]) {
      setThemeName(storedTheme);
    }
  }, []);

  const setTheme = (name: ThemeName) => {
    localStorage.setItem('iwa-theme', name);
    setThemeName(name);
  };
  
  const theme = useMemo(() => themes[themeName], [themeName]);

  useEffect(() => {
    document.body.className = `${theme.colors.bgPrimary} ${theme.colors.textPrimary}`;
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
