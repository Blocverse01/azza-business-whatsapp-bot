import logger from '@/resources/logger';

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
    await logger.error('Uncaught Global Exception:', { error: err });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    await logger.error('Unhandled Global Rejection at:', { promise, reason });
});
