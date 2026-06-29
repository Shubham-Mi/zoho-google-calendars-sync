module.exports = {
  apps: [
    {
      name: 'zoho-gcal',
      script: './server/dist/index.js',
      node_args: `--env-file=${__dirname}/.env`,
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
