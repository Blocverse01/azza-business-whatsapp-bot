import UserService from '../src/app/User/UserService';
import { TEN_THOUSAND } from '../src/constants/numbers';

describe('UserService', () => {
    it(
        'should initialize user wallets successfully',
        async () => {
            const userPhoneNumber = '2348143100808';
            const response = await UserService.createUserWallets(userPhoneNumber);

            // Assert
            expect(response).toBeDefined();
        },
        TEN_THOUSAND * 100
    );
});
