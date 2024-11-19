import bcrypt from 'bcrypt';

export const hashString = async (string: string): Promise<string> => {
    const salt = await generateSalt();
    return bcrypt.hash(string, salt);
};

export const compareHashedString = async (
    string: string,
    hashedString: string
): Promise<boolean> => {
    return bcrypt.compare(string, hashedString);
};

function generateSalt() {
    return bcrypt.genSalt(10);
}
