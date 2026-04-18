module.exports = {
  apps: [{
    name:   'logiroute',
    script: 'server.js',
    env: {
      PORT:     3001,
      NODE_ENV: 'production',
    },
    restart_delay:   3000,
    max_memory_restart: '256M',
  }],
};
