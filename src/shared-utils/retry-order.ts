export const retryWithBackoff = async <T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000,
    factor = 2,
    label = 'Retryable Task'
): Promise<T | null> => {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            return await fn();
        } catch (err: any) {
            attempt++;
            console.warn(`[${label}] Attempt ${attempt} failed: ${err.message || err}`);
            if (attempt < maxRetries) {
                await new Promise(res => setTimeout(res, delayMs * factor ** (attempt - 1)));
            }
        }
    }

    console.error(`[${label}] ❌ All ${maxRetries} attempts failed.`);
    return null;
};
