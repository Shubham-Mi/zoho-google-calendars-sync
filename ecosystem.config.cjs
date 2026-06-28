module.exports = {
  apps: [
    {
      name: 'zoho-gcal',
      script: './server/dist/index.js',
      env_production: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
}
