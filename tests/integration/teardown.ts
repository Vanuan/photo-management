import { execSync } from 'child_process';

/**
 * Teardown function for integration tests
 * Stops all services and cleans up resources
 */
export async function teardownTestEnvironment(): Promise<void> {
  console.log('\n=== Tearing down test environment ===\n');
  
  try {
    console.log('Stopping services...');
    
    // Stop and remove containers, networks, volumes
    execSync('docker-compose -f docker-compose.e2e.yml down -v', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    
    console.log('✓ Services stopped and cleaned up');
    console.log('\n=== Teardown complete ===\n');
  } catch (error) {
    console.error('Failed to teardown test environment:', error);
    // Don't throw - we want to continue cleanup even if some steps fail
  }
}

/**
 * Collect docker logs for debugging failed tests
 */
export function collectDockerLogs(outputPath: string = './logs'): void {
  console.log(`Collecting docker logs to ${outputPath}...`);
  
  try {
    execSync(`mkdir -p ${outputPath}`, { stdio: 'inherit' });
    execSync(
      `docker-compose -f docker-compose.e2e.yml logs > ${outputPath}/docker-compose.log`,
      { stdio: 'inherit', cwd: process.cwd() }
    );
    console.log('✓ Docker logs collected');
  } catch (error) {
    console.error('Failed to collect docker logs:', error);
  }
}
