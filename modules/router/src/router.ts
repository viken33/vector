import { BaseLogger } from "pino";
import { FullChannelState, INodeService } from "@connext/vector-types";
import { Gauge, Registry } from "prom-client";
import { utils } from "ethers";

import { setupListeners } from "./listener";
import { IRouterStore } from "./services/store";

export interface IRouter {
  startup(): Promise<void>;
}

export class Router implements IRouter {
  constructor(
    private readonly publicIdentifier: string,
    private readonly signerAddress: string,
    private readonly service: INodeService,
    private readonly store: IRouterStore,
    private readonly logger: BaseLogger,
    private readonly register: Registry,
  ) {}

  static async connect(
    publicIdentifier: string,
    signerAddress: string,
    service: INodeService,
    store: IRouterStore,
    logger: BaseLogger,
    register: Registry,
  ): Promise<Router> {
    const router = new Router(publicIdentifier, signerAddress, service, store, logger, register);
    await router.startup();
    logger.info("Vector Router connected 🚀");
    return router;
  }

  async startup(): Promise<void> {
    await setupListeners(
      this.publicIdentifier,
      this.signerAddress,
      this.service,
      this.store,
      this.logger,
      this.register,
    );
    this.configureMetrics();
  }

  private configureMetrics() {
    // Track the total number of channels
    const channelCounter = new Gauge({
      name: "router_channels_total",
      help: "router_channels_total_help",
      registers: [this.register],
    });

    const collateral = new Gauge({
      name: "router_channels_collateral",
      help: "router_channels_collateral_help",
      labelNames: ["assetId", "channelAddress"],
      registers: [this.register],
    });

    // TODO: fix this once this issue is fixed by using the `collect` function in the gauge
    // https://github.com/siimon/prom-client/issues/383
    setInterval(async () => {
      this.logger.info({}, "Collecting metrics");
      const channels = await this.service.getStateChannels({ publicIdentifier: this.publicIdentifier });
      if (channels.isError) {
        this.logger.error(
          { error: channels.getError()!.message, publicIdentifier: this.publicIdentifier },
          "Failed to fetch channels",
        );
        return;
      }
      const channelAddresses = channels.getValue();
      channelCounter.set(channelAddresses.length);

      for (const channelAddr of channelAddresses) {
        const channelState = await this.service.getStateChannel({
          channelAddress: channelAddr,
          publicIdentifier: this.publicIdentifier,
        });
        if (channelState.isError) {
          this.logger.error(
            { error: channelState.getError()!.message, channelAddress: channelAddr },
            "Failed to get channel",
          );
          return;
        }
        const { balances, assetIds, aliceIdentifier } = channelState.getValue() as FullChannelState;
        assetIds.forEach((assetId: string, index: number) => {
          const balance = balances[index];
          if (!balance) {
            return;
          }
          // Set the proper collateral gauge
          collateral.set(
            { assetId, channelAddress: channelAddr },
            parseFloat(utils.formatEther(balance.amount[this.publicIdentifier === aliceIdentifier ? 0 : 1])),
          );
        });
      }

      this.logger.info({}, "Done collecting metrics");
    }, 30_000);
  }
}
