export default [{
  env: {
    es2021: true,
    node: true
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: [
    "@typescript-eslint"
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "Literal[value='[Flow Data Exchange]']",
        message: 'BIZBOT-SEC-003: do not log decryptedFlowDataExchange (AES key / PIN / BVN).'
      },
      {
        selector: "Property[key.name='data'] > MemberExpression[property.name='decryptedFlowDataExchange']",
        message: 'BIZBOT-SEC-003: do not log decryptedFlowDataExchange (AES key / PIN / BVN).'
      }
    ]
  }
}]