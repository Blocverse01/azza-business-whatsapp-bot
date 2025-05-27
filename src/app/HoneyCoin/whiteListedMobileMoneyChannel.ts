

export const recommendedOffRampChannelForKenya = {
    paymentChannels: [
        {
            channelName: 'phone',
            channelId: 'a3f3a711-c50e-4e53-b867-7d1d148cd43b'
        }
    ],
    countryFiatLimits: {
        min: 300,
        max: 150000
    }
}


export const mobileMoneyOffRampProvidersForKenya = [
    {
        name: 'Mobile Wallet (M-PESA)',
        networkId: '7ea6df5c-6bba-46b2-a7e6-f511959e7edb',
        channelId: recommendedOffRampChannelForKenya.paymentChannels[0].channelId,
        seerbitId: ''
    }
]