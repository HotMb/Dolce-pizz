declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_SETUP_CODE?: string;
    MARKETING_STOP_SECRET?: string;
    BREVO_API_KEY?: string;
    SMS_SENDER?: string;
    SMS_DEMO?: string;
  }
}

// Vite asset imports (`file.woff2?url`) resolve to the file's public URL.
declare module '*?url' {
  const url: string;
  export default url;
}
