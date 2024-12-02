import UserService from '../src/app/User/UserService';
import { TEN_THOUSAND } from '../src/constants/numbers';
import { dbClient } from '../src/db/dbClient';

describe('UserService', () => {
    it(
        'should initialize user wallets successfully',
        async () => {
            const phoneNumbers = (
                await dbClient.User.filter({
                    'xata.createdAt': {
                        $gt: new Date('2024-11-10'),
                    },
                }).getAll()
            ).map((user) => user.phoneNumber);

            console.log(phoneNumbers.length);

            const promises = phoneNumbers.map((phoneNumber) =>
                UserService.createUserWallets(phoneNumber!)
            );

            const response = await Promise.all(promises);

            // Assert
            expect(response.length).toEqual(phoneNumbers.length);
        },
        TEN_THOUSAND * 10000
    );
    it(
        'Should search for a user by phone number',
        async () => {
            const userPhoneNumber1 = '+2348143100808';
            const userPhoneNumber2 = '+23408143100808';
            const userPhoneNumber3 = '8143100808';
            const invalidPhoneNumberString = '1438100808';

            const [response1, response2, response3, invalidResponse] = await Promise.all([
                UserService.searchUserByPhoneNumber(userPhoneNumber1),
                UserService.searchUserByPhoneNumber(userPhoneNumber2),
                UserService.searchUserByPhoneNumber(userPhoneNumber3),

                UserService.searchUserByPhoneNumber(invalidPhoneNumberString),
            ]);

            // Assert
            expect(response1).toBeDefined();
            expect(response2).toBeDefined();
            expect(response3).toBeTruthy();

            expect(invalidResponse).toBeNull();
        },
        TEN_THOUSAND * 100
    );
});
