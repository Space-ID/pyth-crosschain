import {PriceServiceConnection} from "@pythnetwork/price-service-client";
import * as options from "../options";
import {readPriceConfigFile} from "../price-config";
import fs from "fs";
import {SeiPriceListener, SeiPricePusher} from "./sei";
import {PythPriceListener} from "../pyth-price-listener";
import {Controller} from "../controller";
import {Options} from "yargs";

export default {
    command: "sei",
    describe: "run price pusher for sei",
    builder: {
        "rpc": {
            description: 'rpc url',
            type: "string",
            required: true,
        } as Options,
        network: {
            description: "testnet or mainnet",
            type: "string",
            required: true,
        } as Options,
        ...options.priceConfigFile,
        ...options.priceServiceEndpoint,
        ...options.mnemonicFile,
        ...options.pythContractAddress,
        ...options.pollingFrequency,
        ...options.pushingFrequency,
    },
    handler: function (argv: any) {
        // FIXME: type checks for this
        const {
            rpc,
            priceConfigFile,
            priceServiceEndpoint,
            mnemonicFile,
            pythContractAddress,
            pushingFrequency,
            pollingFrequency,
            network,
        } = argv;

        if (network !== "testnet" && network !== "mainnet") {
            throw new Error("Please specify network. One of [testnet, mainnet]");
        }

        const priceConfigs = readPriceConfigFile(priceConfigFile);
        const priceServiceConnection = new PriceServiceConnection(
            priceServiceEndpoint,
            {
                logger: {
                    // Log only warnings and errors from the price service client
                    info: () => undefined,
                    warn: console.warn,
                    error: console.error,
                    debug: () => undefined,
                    trace: () => undefined,
                },
            }
        );
        const mnemonic = fs.readFileSync(mnemonicFile, "utf-8").trim();

        const priceItems = priceConfigs.map(({id, alias}) => ({id, alias}));

        const pythListener = new PythPriceListener(
            priceServiceConnection,
            priceItems
        );

        const seiListener = new SeiPriceListener(
            pythContractAddress,
            rpc,
            priceItems,
            {
                pollingFrequency,
            }
        );
        const seiPusher = new SeiPricePusher(
            priceServiceConnection,
            pythContractAddress,
            rpc,
            mnemonic,
        );

        const controller = new Controller(
            priceConfigs,
            pythListener,
            seiListener,
            seiPusher,
            {pushingFrequency}
        );

        controller.start();
    },
};
