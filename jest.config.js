let testRegex;
switch (process.env['JEST_TYPE']) {
  case 'integration':
    testRegex = '/integration/.*\\.spec\\.ts$';
    break;
  case 'unit':
  default:
    testRegex = '/test/.*\\.spec\\.ts$';
    break;
}
module.exports = {
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testRegex,
  testURL: 'http://localhost/',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 80,
      lines: 60,
    },
  },
  collectCoverageFrom: ['ts_src/**/*.ts', '!**/node_modules/**'],
  coverageReporters: ['lcov', 'text'],
  verbose: true,
};
