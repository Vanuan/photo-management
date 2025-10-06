import "dotenv/config"; // Load environment variables from .env file first
import { APIServer } from "./src/APIServer";

async function bootstrap() {
  const server = new APIServer();
  try {
    await server.initialize();
    await server.start();
    console.log(
      `API Gateway service started on port ${process.env.PORT || 3000}`,
    );
  } catch (error) {
    console.error("Failed to start API Gateway service:", error);
    process.exit(1);
  }
}

bootstrap();
