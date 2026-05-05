const { env, runtime } = require('./service.config.cjs');

module.exports = {
  apps: [
    {
      name: runtime.serviceName,
      script: 'dist/src/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env,
    },
  ],
};
