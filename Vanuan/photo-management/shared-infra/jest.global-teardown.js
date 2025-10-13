// Global Jest teardown for the entire workspace

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async () => {
  console.log('🧹 Starting Jest global teardown...');

  try {
    // Clean up test isolation resources
    if (global.TEST_ISOLATION) {
      console.log('📊 Cleaning up test isolation resources...');

      // Close any open database connections
      if (global.TEST_ISOLATION.dbConnections) {
        for (const [testId, connection] of global.TEST_ISOLATION.dbConnections) {
          try {
            if (connection && typeof connection.close === 'function') {
              await connection.close();
              console.log(`  ✅ Closed database connection: ${testId}`);
            }
          } catch (error) {
            console.warn(`  ⚠️  Error closing database connection ${testId}:`, error.message);
          }
        }
        global.TEST_ISOLATION.dbConnections.clear();
      }

      // Stop any mock servers
      if (global.TEST_ISOLATION.mockServers) {
        for (const [testId, server] of global.TEST_ISOLATION.mockServers) {
          try {
            if (server && typeof server.close === 'function') {
              server.close();
              console.log(`  ✅ Stopped mock server: ${testId}`);
            }
          } catch (error) {
            console.warn(`  ⚠️  Error stopping mock server ${testId}:`, error.message);
          }
        }
        global.TEST_ISOLATION.mockServers.clear();
      }

      // Clean up temporary files
      if (global.testHelpers && typeof global.testHelpers.cleanupTempFiles === 'function') {
        global.testHelpers.cleanupTempFiles();
        console.log('  ✅ Cleaned up temporary files');
      }
    }

    // Generate test summary report
    await generateTestSummary();

    // Clean up test artifacts (optional, based on environment)
    if (process.env.CLEANUP_TEST_ARTIFACTS !== 'false') {
      await cleanupTestArtifacts();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('  ✅ Forced garbage collection');
    }

    console.log('✅ Jest global teardown completed successfully');

  } catch (error) {
    console.error('❌ Jest global teardown failed:', error.message);
    console.error(error.stack);

    // Don't throw the error to prevent test failure due to cleanup issues
    // Just log it and continue
  }

  // Final cleanup of environment variables
  cleanupEnvironmentVariables();
};

async function generateTestSummary() {
  try {
    const coverageDir = path.join(__dirname, 'coverage');
    const testResultsDir = path.join(__dirname, 'test-results');

    const summary = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      testResults: {
        directory: testResultsDir,
        exists: fs.existsSync(testResultsDir)
      },
      coverage: {
        directory: coverageDir,
        exists: fs.existsSync(coverageDir)
      },
      packages: [
        'storage-core',
        'storage-client',
        'storage-service'
      ],
      configuration: {
        nodeVersion: process.version,
        platform: process.platform,
        maxWorkers: process.env.MAX_WORKERS || 'default',
        testTimeout: process.env.TEST_TIMEOUT || '30000ms'
      }
    };

    // Check for coverage files
    if (summary.coverage.exists) {
      try {
        const coverageFiles = fs.readdirSync(coverageDir);
        summary.coverage.files = coverageFiles.length;
        summary.coverage.hasLcov = coverageFiles.includes('lcov.info');
        summary.coverage.hasHtml = fs.existsSync(path.join(coverageDir, 'lcov-report'));
      } catch (error) {
        summary.coverage.error = error.message;
      }
    }

    // Check for test result files
    if (summary.testResults.exists) {
      try {
        const resultFiles = fs.readdirSync(testResultsDir);
        summary.testResults.files = resultFiles.length;
        summary.testResults.hasJunit = resultFiles.includes('junit.xml');
      } catch (error) {
        summary.testResults.error = error.message;
      }
    }

    // Write summary to file
    const summaryPath = path.join(__dirname, 'test-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log('  ✅ Generated test summary report');

  } catch (error) {
    console.warn('  ⚠️  Could not generate test summary:', error.message);
  }
}

async function cleanupTestArtifacts() {
  try {
    // Define paths to clean up
    const cleanupPaths = [
      '.jest-cache',
      'packages/*/coverage',
      'packages/*/test-results',
      'packages/*/.jest-cache'
    ];

    // Clean up based on environment settings
    const preserveCoverage = process.env.PRESERVE_COVERAGE === 'true';
    const preserveResults = process.env.PRESERVE_TEST_RESULTS === 'true';

    if (!preserveCoverage) {
      try {
        execSync('find . -name "coverage" -type d -exec rm -rf {} + 2>/dev/null || true', {
          cwd: __dirname,
          stdio: 'ignore'
        });
        console.log('  ✅ Cleaned up coverage directories');
      } catch (error) {
        console.warn('  ⚠️  Could not clean coverage directories:', error.message);
      }
    }

    if (!preserveResults) {
      try {
        execSync('find . -name "test-results" -type d -exec rm -rf {} + 2>/dev/null || true', {
          cwd: __dirname,
          stdio: 'ignore'
        });
        console.log('  ✅ Cleaned up test result directories');
      } catch (error) {
        console.warn('  ⚠️  Could not clean test result directories:', error.message);
      }
    }

    // Always clean up cache directories
    try {
      execSync('find . -name ".jest-cache" -type d -exec rm -rf {} + 2>/dev/null || true', {
        cwd: __dirname,
        stdio: 'ignore'
      });
      console.log('  ✅ Cleaned up Jest cache directories');
    } catch (error) {
      console.warn('  ⚠️  Could not clean Jest cache directories:', error.message);
    }

  } catch (error) {
    console.warn('  ⚠️  Error during artifact cleanup:', error.message);
  }
}

function cleanupEnvironmentVariables() {
  const testEnvVars = [
    'TEST_ISOLATION',
    'SQLITE_DB_PATH',
    'MINIO_ENDPOINT',
    'MINIO_PORT',
    'STORAGE_SERVICE_URL',
    'CACHE_ENABLED',
    'MAX_WORKERS',
    'STRICT_VALIDATION',
    'DEBUG_MODE',
    'CLEANUP_TEMP_FILES'
  ];

  testEnvVars.forEach(envVar => {
    delete process.env[envVar];
  });

  console.log('  ✅ Cleaned up test environment variables');
}

// Handle process cleanup signals
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, performing emergency cleanup...');
  if (global.testHelpers && typeof global.testHelpers.cleanupTempFiles === 'function') {
    global.testHelpers.cleanupTempFiles();
  }
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, performing emergency cleanup...');
  if (global.testHelpers && typeof global.testHelpers.cleanupTempFiles === 'function') {
    global.testHelpers.cleanupTempFiles();
  }
});
