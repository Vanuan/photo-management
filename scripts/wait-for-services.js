const http = require('http');
const { createClient } = require('redis');

const SERVICES = [
  { name: 'API Gateway', url: 'http://localhost:3000/health' },
  { name: 'Storage Service', url: 'http://localhost:3001/health' },
];

const REDIS_CONFIG = { host: 'localhost', port: 6379 };
const MAX_RETRIES = 60;
const RETRY_DELAY = 2000;

async function checkService(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 503);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function checkRedis() {
  const client = createClient({
    socket: REDIS_CONFIG,
  });

  try {
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch (error) {
    try {
      await client.disconnect();
    } catch (e) {
      // Ignore
    }
    return false;
  }
}

async function waitForService(name, checkFn, maxRetries = MAX_RETRIES) {
  console.log(`Waiting for ${name}...`);

  for (let i = 0; i < maxRetries; i++) {
    const isReady = await checkFn();

    if (isReady) {
      console.log(`✓ ${name} is ready`);
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  console.error(`✗ ${name} failed to start after ${maxRetries} retries`);
  return false;
}

async function main() {
  console.log('Waiting for services to be ready...\n');

  // Check Redis
  const redisReady = await waitForService('Redis', checkRedis);
  if (!redisReady) {
    process.exit(1);
  }

  // Check all HTTP services
  for (const service of SERVICES) {
    const isReady = await waitForService(service.name, () =>
      checkService(service.url)
    );
    if (!isReady) {
      process.exit(1);
    }
  }

  console.log('\n✅ All services are ready!\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error waiting for services:', error);
  process.exit(1);
});
