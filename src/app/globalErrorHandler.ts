import logger from '@/resources/logger';

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
    try {
        await logger.error('Unhandled Global Exception at:', err);
    } catch (error) {
        console.error('Error logging uncaught exception:', error);
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    try {
        await logger.error('Unhandled Global Rejection at:', {
            reason,
            promise,
        });
    } catch (error) {
        console.error('Error logging unhandled rejection:', error);
    }
});
