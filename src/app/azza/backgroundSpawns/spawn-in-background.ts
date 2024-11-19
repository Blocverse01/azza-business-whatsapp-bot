import { spawn } from 'child_process';
import { logSync } from '@/resources/logger';

/**
 * This function is used to spawn a script in the background
 * It takes in a script path and a params object
 * The params object is stringified and passed to the script as an argument
 * @param params
 * @param scriptPath
 */
export const spawnInBackground = <Params>(params: Params, scriptPath: `${string}.ts`) => {
    // Create a new child process
    const child = spawn('tsx', [scriptPath, JSON.stringify(params)], {
        stdio: 'inherit',
    });

    // Listen for the exit event
    child.on('exit', (code) => {
        if (code !== 0) {
            logSync('error', `Process exited with code: ${code}`);
        }
    });

    child.on('error', (err) => {
        logSync('error', 'Failed to start background process:', err);
    });
};
