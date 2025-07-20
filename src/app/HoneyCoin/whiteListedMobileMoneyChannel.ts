

export const recommendedOffRampChannelForKenya = {
    paymentChannels: [
        {
            channelName: 'phone',
            channelId: 'c2b2eeda-d4ca-49fd-ba21-0781ffa7714b'
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