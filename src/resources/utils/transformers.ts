function snakeToCamel(str: string): string {
    return str.replace(/(_\w)/g, (matches) => matches[1].toUpperCase());
}

export function transformKeysToCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(transformKeysToCamelCase);
    } else if (obj && typeof obj === 'object') {
        return Object.keys(obj).reduce((result, key) => {
            const camelKey = snakeToCamel(key);
            result[camelKey] = transformKeysToCamelCase(obj[key]);
            return result;
        }, {} as any);
    }
    return obj; // Primitive types like string, number, etc., are returned as-is
}

export const capitalize = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.toLowerCase().slice(1);
};

export const truncate = (str: string, maxLength: number): string => {
    // Truncate text in the middle
    if (str.length > maxLength) {
        const breakpoint = maxLength / 2;
        return str.slice(0, breakpoint) + '...' + str.slice(str.length - breakpoint);
    }
    return str;
};

export const clipDecimal = (num: number, decimals: number): number => {
    const factor = 10 ** decimals;
    return Math.trunc(num * factor) / factor;
};
