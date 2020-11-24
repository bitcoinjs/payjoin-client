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
      statements: 80,
      branches: 65,
      functions: 90,
      lines: 80,
    },
  },
  setupFiles: [
    './jest-setup.js'
  ],
  collectCoverageFrom: ['ts_src/**/*.ts', '!**/node_modules/**'],
  coverageReporters: ['lcov', 'text', 'html'],
  verbose: true,
};
