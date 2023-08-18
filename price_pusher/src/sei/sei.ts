import {
    HexString,
    PriceServiceConnection,
} from "@pythnetwork/price-service-client";
import {
    IPricePusher,
    PriceInfo,
    ChainPriceListener,
    PriceItem,
} from "../interface";
import {DurationInSeconds} from "../utils";
import {getCosmWasmClient, getSigningCosmWasmClient} from "@sei-js/core";
import {CosmWasmClient, SigningCosmWasmClient} from '@cosmjs/cosmwasm-stargate';
import {DirectSecp256k1HdWallet} from "@cosmjs/proto-signing";
import {calculateFee} from "@cosmjs/stargate";

const DEFAULT_GAS_PRICE = 500000000;

type PriceQueryResponse = {
    price_feed: {
        id: string;
        price: {
            price: string;
            conf: string;
            expo: number;
            publish_time: number;
        };
    };
};

type UpdateFeeResponse = {
    denom: string;
    amount: string;
};

// this use price without leading 0x
export class SeiPriceListener extends ChainPriceListener {
    cosmClient?: CosmWasmClient

    constructor(
        private pythContractAddress: string,
        private rpc: string,
        priceItems: PriceItem[],
        config: {
            pollingFrequency: DurationInSeconds;
        }
    ) {
        super("Sei", config.pollingFrequency, priceItems);
    }

    private async getClient() {
        if (this.cosmClient) return this.cosmClient;
        this.cosmClient = await getCosmWasmClient(this.rpc)
        return this.cosmClient
    }

    async getOnChainPriceInfo(
        priceId: HexString
    ): Promise<PriceInfo | undefined> {
        let priceQueryResponse: PriceQueryResponse;
        try {
            const client = await this.getClient()
            const data = await client.queryContractSmart(
                this.pythContractAddress,
                {
                    'price_feed': {
                        id: priceId
                    }
                }
            );
            priceQueryResponse = data
        } catch (e) {
            console.error(`Polling on-chain price for ${priceId} failed. Error:`);
            console.error(e);
            return undefined;
        }

        console.log(
            `Polled an Sei on chain price for feed ${this.priceIdToAlias.get(
                priceId
            )} (${priceId}).`
        );

        return {
            conf: priceQueryResponse.price_feed.price.conf,
            price: priceQueryResponse.price_feed.price.price,
            publishTime: priceQueryResponse.price_feed.price.publish_time,
        };
    }
}

export class SeiPricePusher implements IPricePusher {
    private wallet?: DirectSecp256k1HdWallet;
    private account: string | null = null;
    private mnemonic: string
    cosmClient?: CosmWasmClient
    cosmSignClient?: SigningCosmWasmClient

    constructor(
        private priceServiceConnection: PriceServiceConnection,
        private pythContractAddress: string,
        private rpc: string,
        mnemonic: string,
    ) {
        this.mnemonic = mnemonic;
    }

    private async getClient() {
        if (this.cosmClient) return this.cosmClient;
        this.cosmClient = await getCosmWasmClient(this.rpc)
        return this.cosmClient
    }

    private async getSignClient() {
        if (this.cosmSignClient) return this.cosmSignClient;
        const wallet = await this.getWallet()
        this.cosmSignClient = await getSigningCosmWasmClient(this.rpc, wallet);
        return this.cosmSignClient
    }

    private async getWallet() {
        if (this.wallet) return this.wallet;
        this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic,{prefix:'sei'})
        return this.wallet
    }

    private async seiAddress(): Promise<string> {
        if (this.account) return this.account
        const wallet = await this.getWallet()
        const [firstAccount] = await wallet.getAccounts();
        this.account = firstAccount.address
        return this.account;
    }

    // private async signAndBroadcastMsg(msg: Msgs): Promise<TxResponse> {
    //     const chainGrpcAuthApi = new ChainGrpcAuthApi(this.grpcEndpoint);
    //     // Fetch the latest account details only if it's not stored.
    //     this.account ??= await chainGrpcAuthApi.fetchAccount(
    //         this.seiAddress()
    //     );
    //
    //     const {txRaw: simulateTxRaw} = createTransactionFromMsg({
    //         sequence: this.account.baseAccount.sequence,
    //         accountNumber: this.account.baseAccount.accountNumber,
    //         message: msg,
    //         chainId: this.chainConfig.chainId,
    //         pubKey: this.wallet.toPublicKey().toBase64(),
    //     });
    //
    //     const txService = new TxGrpcClient(this.grpcEndpoint);
    //     // simulation
    //     const {
    //         gasInfo: {gasUsed},
    //     } = await txService.simulate(simulateTxRaw);
    //
    //     // simulation returns us the approximate gas used
    //     // gas passed with the transaction should be more than that
    //     // in order for it to be successfully executed
    //     // this multiplier takes care of that
    //     const gas = (gasUsed * this.chainConfig.gasMultiplier).toFixed();
    //     const fee = {
    //         amount: [
    //             {
    //                 denom: "inj",
    //                 amount: (Number(gas) * this.chainConfig.gasPrice).toFixed(),
    //             },
    //         ],
    //         gas,
    //     };
    //
    //     const {signBytes, txRaw} = createTransactionFromMsg({
    //         sequence: this.account.baseAccount.sequence,
    //         accountNumber: this.account.baseAccount.accountNumber,
    //         message: msg,
    //         chainId: this.chainConfig.chainId,
    //         fee,
    //         pubKey: this.wallet.toPublicKey().toBase64(),
    //     });
    //
    //     const sig = await this.wallet.sign(Buffer.from(signBytes));
    //
    //     try {
    //         this.account.baseAccount.sequence++;
    //
    //         /** Append Signatures */
    //         txRaw.signatures = [sig];
    //         // this takes approx 5 seconds
    //         const txResponse = await txService.broadcast(txRaw);
    //
    //         return txResponse;
    //     } catch (e: any) {
    //         // The sequence number was invalid and hence we will have to fetch it again.
    //         if (JSON.stringify(e).match(/account sequence mismatch/) !== null) {
    //             // We need to fetch the account details again.
    //             this.account = null;
    //         }
    //         throw e;
    //     }
    // }

    async getPriceFeedUpdateObject(priceIds: string[]): Promise<any> {
        const vaas = await this.priceServiceConnection.getLatestVaas(priceIds);

        return {
            update_price_feeds: {
                data: vaas,
            },
        };
    }

    async updatePriceFeed(
        priceIds: string[],
        pubTimesToPush: number[]
    ): Promise<void> {
        if (priceIds.length === 0) {
            return;
        }
        // console.log('sei update price feed:', priceIds, pubTimesToPush)
        if (priceIds.length !== pubTimesToPush.length)
            throw new Error("Invalid arguments");

        let priceFeedUpdateObject;
        try {
            // get the latest VAAs for updatePriceFeed and then push them
            priceFeedUpdateObject = await this.getPriceFeedUpdateObject(priceIds);
        } catch (e) {
            console.error("Error fetching the latest vaas to push");
            console.error(e);
            return;
        }

        let updateFeeQueryResponse: UpdateFeeResponse;
        try {
            const client = await this.getClient();
            const data = await client.queryContractSmart(
                this.pythContractAddress,
                {
                    get_update_fee: {
                        vaas: priceFeedUpdateObject.update_price_feeds.data,
                    },
                }
            );
            // console.log('get_update_fee:', data)
            updateFeeQueryResponse = data;
        } catch (e) {
            console.error("Error fetching update fee");
            console.error(e);
            return;
        }

        try {
            const account = await this.seiAddress()
            const client = await this.getSignClient()
            const fee = calculateFee(1300000, "0.1usei");
            // console.log('update fee:', account, updateFeeQueryResponse)
            const rs = await client.execute(account, this.pythContractAddress, priceFeedUpdateObject, fee, undefined, [updateFeeQueryResponse]);
            // console.log("Succesfully broadcasted txHash:", rs.transactionHash);
        } catch (e: any) {
            console.error("Error executing update messages");
            console.error(e);
        }
    }
}
