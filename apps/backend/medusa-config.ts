import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { networkInterfaces } from "node:os";
const {
  getConfiguredMedusaDbSchema,
  withDbSchemaSearchPath,
} = require("./src/lib/database-schema");

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const baseDatabaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const configuredDbSchema = getConfiguredMedusaDbSchema(process.env);
const pgSslMode = process.env.PGSSLMODE?.toLowerCase().trim();
const disablePgSsl =
  pgSslMode === "disable" ||
  pgSslMode === "false" ||
  pgSslMode === "0" ||
  pgSslMode === "off";
const getDatabaseUrl = () => withDbSchemaSearchPath(baseDatabaseUrl);

const splitCorsOrigins = (value?: string) =>
  (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const dedupeOrigins = (origins: string[]) => Array.from(new Set(origins));
const FRONTEND_DEVELOPMENT_PORTS = [5173, 5174, 5175, 5176];

const isPrivateIPv4Address = (value: string) =>
  /^10\./.test(value) ||
  /^192\.168\./.test(value) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(value);

const resolveLanOriginsForPort = (port: number) => {
  const interfaces = networkInterfaces();
  const origins: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      if (!isPrivateIPv4Address(entry.address)) {
        continue;
      }

      origins.push(`http://${entry.address}:${port}`);
    }
  }

  return dedupeOrigins(origins);
};

const withDevelopmentCorsOrigins = (value: string | undefined, ports: number[]) => {
  const configuredOrigins = splitCorsOrigins(value);

  if (process.env.NODE_ENV === "production") {
    return configuredOrigins.join(",");
  }

  const developmentOrigins = ports.flatMap((port) => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://0.0.0.0:${port}`,
    ...resolveLanOriginsForPort(port),
  ]);

  return dedupeOrigins([...configuredOrigins, ...developmentOrigins]).join(",");
};

module.exports = defineConfig({
  admin: {
    vite: () => {
      let hmrServer;
      if (process.env.HMR_BIND_HOST) {
        const { createServer } = require("http");
        hmrServer = createServer();
        const hmrPort = parseInt(process.env.HMR_PORT || "9001");
        hmrServer.listen(hmrPort, process.env.HMR_BIND_HOST);
      }

      let allowedHosts;
      if (process.env.__MEDUSA_ADDITIONAL_ALLOWED_HOSTS) {
        allowedHosts = [process.env.__MEDUSA_ADDITIONAL_ALLOWED_HOSTS];
      }

      return {
        server: {
          allowedHosts,
          hmr: {
            server: hmrServer,
          },
        },
        build: {
          rollupOptions: {
            // Work around Rollup bug in static evaluation that crashes Medusa admin builds in Docker/CI.
            treeshake: false,
          },
        },
      };
    },
  },
  projectConfig: {
    databaseUrl: getDatabaseUrl(),
    databaseSchema: configuredDbSchema || "public",
    databaseDriverOptions: disablePgSsl ? { ssl: false } : undefined,

    http: {
      storeCors: withDevelopmentCorsOrigins(process.env.STORE_CORS, [8000, ...FRONTEND_DEVELOPMENT_PORTS]),
      adminCors: withDevelopmentCorsOrigins(process.env.ADMIN_CORS, [9000, ...FRONTEND_DEVELOPMENT_PORTS]),
      authCors: withDevelopmentCorsOrigins(process.env.AUTH_CORS, [8000, 9000, ...FRONTEND_DEVELOPMENT_PORTS]),
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    {
      resolve: "./src/modules/subscription",
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            id: "s3",
            resolve: "@medusajs/medusa/file-s3",
            is_default: true,
            options: process.env.R2_FILE_URL
              ? {
                  file_url: process.env.R2_FILE_URL,
                  prefix: process.env.R2_PREFIX,
                  bucket: process.env.R2_BUCKET,
                  endpoint: process.env.R2_ENDPOINT,
                  access_key_id: process.env.R2_ACCESS_KEY_ID,
                  secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
                  region: "auto",
                  additional_client_config: {
                    forcePathStyle: false,
                    requestChecksumCalculation: "WHEN_REQUIRED",
                  },
                }
              : {
                  authentication_method: "s3-iam-role",
                  file_url: process.env.S3_FILE_URL,
                  prefix: process.env.S3_PREFIX,
                  bucket: process.env.S3_BUCKET,
                  endpoint: process.env.S3_ENDPOINT,
                  region: process.env.S3_REGION,
                },
          },
        ],
      },
    },
  ],
});
