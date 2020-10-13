import {
  EngineEvents,
  RouterSchemas,
  INodeService,
  ConditionalTransferCreatedPayload,
  DepositReconciledPayload,
} from "@connext/vector-types";
import { Gauge, Registry } from "prom-client";
import Ajv from "ajv";
import { providers } from "ethers";
import { BaseLogger } from "pino";

import { config } from "./config";
import { forwardTransferCreation, forwardTransferResolution } from "./forwarding";
import { IRouterStore } from "./services/store";

const ajv = new Ajv();

export type ChainJsonProviders = {
  [k: string]: providers.JsonRpcProvider;
};
const chainProviders: ChainJsonProviders = Object.entries(config.chainProviders).reduce((acc, [chainId, url]) => {
  acc[chainId] = new providers.JsonRpcProvider(url);
  return acc;
}, {} as ChainJsonProviders);

const configureMetrics = (register: Registry) => {
  // Track number of times a payment was forwarded
  const attempts = new Gauge({
    name: "router_forwarded_payment_attempts",
    help: "router_forwarded_payment_attempts_help",
    labelNames: ["transferId"],
  });
  register.registerMetric(attempts);

  // Track successful forwards
  const successful = new Gauge({
    name: "router_successful_forwarded_payments",
    help: "router_successful_forwarded_payments_help",
    labelNames: ["transferId"],
  });
  register.registerMetric(successful);

  // Track failing forwards
  const failed = new Gauge({
    name: "router_failed_forwarded_payments",
    help: "router_failed_forwarded_payments_help",
    labelNames: ["transferId"],
  });
  register.registerMetric(failed);

  // Return the metrics so they can be incremented as needed
  return { failed, successful, attempts };
};

export async function setupListeners(
  publicIdentifier: string,
  signerAddress: string,
  service: INodeService,
  store: IRouterStore,
  logger: BaseLogger,
  register: Registry,
): Promise<void> {
  const { failed, successful, attempts } = configureMetrics(register);
  // TODO, node should be wrapper around grpc
  // Set up listener to handle transfer creation
  await service.on(
    EngineEvents.CONDITIONAL_TRANSFER_CREATED,
    async (data: ConditionalTransferCreatedPayload) => {
      attempts.labels(data.transfer.transferId).inc(1);
      const end = successful.startTimer();
      const res = await forwardTransferCreation(
        data,
        publicIdentifier,
        signerAddress,
        service,
        store,
        logger,
        chainProviders,
      );
      if (res.isError) {
        failed.labels(data.transfer.transferId).inc(1);
        return logger.error(
          { method: "forwardTransferCreation", error: res.getError()?.message, context: res.getError()?.context },
          "Error forwarding transfer",
        );
      }
      end();
      successful.labels(data.transfer.transferId).inc(1);
      logger.info({ method: "forwardTransferCreation", result: res.getValue() }, "Successfully forwarded transfer");
    },
    (data: ConditionalTransferCreatedPayload) => {
      // Only forward transfers with valid routing metas
      const validate = ajv.compile(RouterSchemas.RouterMeta);
      const valid = validate(data.transfer.meta);
      if (!valid) {
        logger.info(
          {
            transferId: data.transfer.transferId,
            channelAddress: data.channelAddress,
            errors: validate.errors?.map(err => err.message),
          },
          "Not forwarding non-routing transfer",
        );
        return false;
      }

      if (data.transfer.initiator === signerAddress) {
        logger.info(
          { initiator: data.transfer.initiator },
          "Not forwarding transfer which was initiated by our node, doing nothing",
        );
        return false;
      }

      if (!data.transfer.meta.path[0].recipient || data.transfer.meta.path.recipient === publicIdentifier) {
        logger.warn({ path: data.transfer.meta.path[0] }, "Not forwarding transfer with no path to follow");
        return false;
      }
      return true;
    },
  );

  // Set up listener to handle transfer resolution
  await service.on(
    EngineEvents.CONDITIONAL_TRANSFER_RESOLVED,
    async (data: ConditionalTransferCreatedPayload) => {
      const res = await forwardTransferResolution(data, publicIdentifier, signerAddress, service, store, logger);
      if (res.isError) {
        return logger.error(
          { method: "forwardTransferResolution", error: res.getError()?.message, context: res.getError()?.context },
          "Error forwarding resolution",
        );
      }
      logger.info({ method: "forwardTransferResolution", result: res.getValue() }, "Successfully forwarded resolution");
    },
    (data: ConditionalTransferCreatedPayload) => {
      // Only forward transfers with valid routing metas
      const validate = ajv.compile(RouterSchemas.RouterMeta);
      const valid = validate(data.transfer.meta);
      if (!valid) {
        logger.info(
          {
            transferId: data.transfer.transferId,
            channelAddress: data.channelAddress,
            errors: validate.errors?.map(err => err.message),
          },
          "Not forwarding non-routing transfer",
        );
        return false;
      }

      // If there is no resolver, do nothing
      if (!data.transfer.transferResolver) {
        logger.warn(
          {
            transferId: data.transfer,
            routingId: data.transfer.meta.routingId,
            channelAddress: data.transfer.channelAddress,
          },
          "No resolver found in transfer",
        );
        false;
      }

      // If we are the receiver of this transfer, do nothing
      if (data.transfer.responder === signerAddress) {
        logger.info({ routingId: data.transfer.meta.routingId }, "Nothing to reclaim");
        return false;
      }

      return true;
    },
  );

  await service.on(
    EngineEvents.DEPOSIT_RECONCILED, // TODO types
    async (data: DepositReconciledPayload) => {
      // await handleCollateralization(data);
    },
  );

  // service.on(
  //   EngineEvents.IS_ALIVE, // TODO types
  //   async data => {
  //     await handleIsAlive(data);
  //   },
  // );
}
