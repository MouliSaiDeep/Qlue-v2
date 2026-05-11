module.exports = {
  testEnvironment: 'node',
  collectCoverage: false,
  modulePathIgnorePatterns: [
    "<rootDir>/.aws-sam",
    "<rootDir>/layers"
  ],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/"
  ]
};
