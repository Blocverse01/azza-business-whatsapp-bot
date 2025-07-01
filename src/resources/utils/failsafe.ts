export const tryOrNull = async <T>(promise: Promise<T>): Promise<T | null> => {
    try {
        return await promise;
    } catch (e) {
        return null;
    }
};
