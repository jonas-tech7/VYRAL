import { loadEnvConfig } from "@next/env";

// Load .env.local etc., then point integration tests at the test database.
loadEnvConfig(process.cwd(), true);
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
