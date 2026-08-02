import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'legacy-archive/**',
      'docs/**',
      'docs(md/**',
      '.claude/**',
    ],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-debugger': 'warn',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]
