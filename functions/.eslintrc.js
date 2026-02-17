module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
    "/archive/**/*", // Archived legacy code is not lint-gated.
    "/scripts/**/*", // One-off local scripts (JS) are not lint-gated.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    // Indentation is enforced via formatter/editorconfig, not ESLint.
    "indent": "off",
    // Windows + mixed contributors: do not enforce LF/CRLF at lint time.
    "linebreak-style": "off",
  },
};
