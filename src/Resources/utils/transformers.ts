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
