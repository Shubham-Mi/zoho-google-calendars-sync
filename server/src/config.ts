function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  DATABASE_URL: requireEnv('DATABASE_URL'),
  JWT_SECRET: requireEnv('JWT_SECRET'),
  TOKEN_ENCRYPTION_KEY: requireEnv('TOKEN_ENCRYPTION_KEY'),
  ZOHO_CLIENT_ID: requireEnv('ZOHO_CLIENT_ID'),
  ZOHO_CLIENT_SECRET: requireEnv('ZOHO_CLIENT_SECRET'),
  ZOHO_REDIRECT_URI: requireEnv('ZOHO_REDIRECT_URI'),
  GOOGLE_CLIENT_ID: requireEnv('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: requireEnv('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: requireEnv('GOOGLE_REDIRECT_URI'),
  PORT: process.env.PORT ?? '3000',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
}
