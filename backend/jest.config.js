module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/audio-gateway/'],
  modulePathIgnorePatterns: ['<rootDir>/layers/dependencies/', '<rootDir>/.aws-sam/'],
  collectCoverage: false,
  // All-source baseline: 57.14% statements / 50.82% branches on 22 Oct 2026.
  // Keep a small platform buffer; raise these floors as uncovered paths gain tests.
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: { statements: 55, branches: 48, functions: 55, lines: 58 }
  },
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/"
  ]
};
