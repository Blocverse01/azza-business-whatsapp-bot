import { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleDirectories: ['node_modules'],
    moduleNameMapper: {
        '@/(.*)': '<rootDir>/src/$1',
    },
    setupFiles: ['<rootDir>/tests/setupEnv.ts'],
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    target: 'ES2022',
                    module: 'commonjs',
                    esModuleInterop: true,
                    strict: true,
                    skipLibCheck: true,
                    baseUrl: './src',
                    paths: {
                        '@/*': ['./*'],
                    },
                },
            },
        ],
    },
};

export default jestConfig;
