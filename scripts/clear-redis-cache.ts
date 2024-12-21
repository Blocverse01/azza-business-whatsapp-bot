import Redis from 'ioredis';
import process from 'node:process';
import * as readline from 'node:readline';
import env from '../src/constants/env';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function runScript() {
    rl.question(
        'Enter the cache keys to clear (separate multi keys with a comma: ',
        async (keys) => {
            if (!keys) {
                console.error('No keys provided');
                process.exit(1);
            }

            await clearCache(keys.split(','));
            rl.close();
        }
    );
}

async function clearCache(keys: string[]) {
    const redis = new Redis(env.REDIS_URL);
    await redis.del(keys);
    redis.disconnect();

    console.log(`Cleared cache for keys:\n`);
    console.table(keys);
}

runScript();
