import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import typescriptEslint from "@typescript-eslint/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      react,
      "react-hooks": reactHooks,
      "@typescript-eslint": typescriptEslint,
    },
    // Legacy UI modules are incrementally typed. Keep these visible without
    // blocking security patches and production builds.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  // New feature boundaries are enforced while legacy modules move incrementally.
  {
    files: ["src/features/**/components/**/*.{ts,tsx}", "src/features/**/domain/**/*.ts", "src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["@/lib/prisma", "@/lib/auth", "@/lib/evidence-storage"],
        patterns: ["@/server/**", "@/features/**/server/**", "../server/**", "../../server/**"],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-frontend/**",
    ".next-backend/**",
    "out/**",
    "build/**",
    ".tmp-*/**",
    "release-review/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
