module.exports = {
    apps: [
        {
            script: './src/index.ts',
            watch: './src',
            interpreter: 'node',
            interpreter_args:
                process.env.NODE_ENV === 'production'
                    ? '--import tsx'
                    : '--import tsx --env-file=.env',
            name: 'azza_cluster_app',
            exec_mode: 'cluster',
            instances: 'max',
        },
        {
            script: './service-worker/',
            watch: ['./service-worker'],
        },
    ],

    deploy: {
        production: {
            user: 'SSH_USERNAME',
            host: 'SSH_HOSTMACHINE',
            ref: 'origin/master',
            repo: 'GIT_REPOSITORY',
            path: 'DESTINATION_PATH',
            'pre-deploy-local': '',
            'post-deploy': 'pnpm install && pm2 reload ecosystem.config.cjs --env production',
            'pre-setup': '',
        },
    },
};
