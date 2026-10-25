import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

// Secrets for the dev server only (vinext loads `.env.local` into process.env);
// builds never embed them, hosted values come from the platform's secret settings.
const localVars: Record<string, string> = Object.fromEntries(
  ["ADMIN_SETUP_CODE", "MARKETING_STOP_SECRET", "BREVO_API_KEY", "SMS_SENDER", "SMS_CAMPAIGNS_DEMO", "NOTIFICATION_DISPATCH_SECRET", "INTERNAL_ACCESS_KEYS_JSON"]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name] ?? ""]),
);

// A prototype deployed straight to Cloudflare, outside the Sites platform, names
// its worker and real D1 database at build time (see scripts/deploy-demo.mjs).
const deployName = process.env.CF_WORKER_NAME;
const deployDatabase = process.env.CF_D1_DATABASE_ID;

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  ...(deployName ? { name: deployName } : {}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: deployName ?? "site-creator-d1",
          database_id: deployDatabase ?? SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve" && Object.keys(localVars).length ? { vars: localVars } : {}),
        },
      }),
    ],
  };
});
