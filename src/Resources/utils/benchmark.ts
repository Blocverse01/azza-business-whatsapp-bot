interface BenchmarkResult {
    timeTakenForA: string; // e.g., "3s"
    timeTakenForB: string; // e.g., "2.5s"
    timeDifference: string; // e.g., "0.5s"
    improvementPercent: string; // e.g., "16.67%"
}

export async function benchmark<T>(
    operationA: () => Promise<T>,
    operationB: () => Promise<T>
): Promise<BenchmarkResult> {
    // Measure time for Operation A
    const startTimeA = new Date().getTime();
    await operationA();
    const timeTakenForA = (new Date().getTime() - startTimeA) / 1000; // Convert to seconds

    // Measure time for Operation B
    const startTimeB = new Date().getTime();
    await operationB();
    const timeTakenForB = (new Date().getTime() - startTimeB) / 1000; // Convert to seconds

    // Calculate time difference and improvement percentage
    const timeDifference = timeTakenForA - timeTakenForB;
    const improvementPercent = ((timeDifference / timeTakenForA) * 100).toFixed(2);

    // Return the result formatted as strings
    return {
        timeTakenForA: `${timeTakenForA.toFixed(2)}s`,
        timeTakenForB: `${timeTakenForB.toFixed(2)}s`,
        timeDifference: `${timeDifference.toFixed(2)}s`,
        improvementPercent: `${improvementPercent}%`,
    };
}
