import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      // Generated/vendor assets copied into public/ for offline use.
      "public/vendor/**",
    ],
  },
  // This repo includes a few large client files and declaration shims where `any` is pragmatic.
  // Treating it as an error blocks CI for non-safety-critical types.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Avoid blocking CI on stylistic/heuristic rules for this app.
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]
