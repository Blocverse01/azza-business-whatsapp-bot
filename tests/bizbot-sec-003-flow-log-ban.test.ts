import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const fullPath = join(dir, entry);
        return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
    });
}

describe('BIZBOT-SEC-003 Flow decrypted payload logging ban', () => {
    it('does not log decryptedFlowDataExchange or the Flow Data Exchange dump', () => {
        const files = walk(join(__dirname, '../src')).filter((file) => file.endsWith('.ts'));
        const dumpPattern =
            /(logger\.(debug|info|warn|error)|logSync|console\.(log|debug|info|warn|error))\([\s\S]{0,200}(data:\s*)?req\.decryptedFlowDataExchange(?!\.)/;

        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            expect(source).not.toMatch(dumpPattern);
            expect(source).not.toContain('[Flow Data Exchange]');
        }
    });
});
