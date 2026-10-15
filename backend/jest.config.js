module.exports = {
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/layers/dependencies/', '<rootDir>/.aws-sam/'],
  collectCoverage: false,
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/"
  ]
};
