module.exports = {
  apps: [{
    name: 'xentra-agent-ts',
    script: './dist/server.js',
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
};
