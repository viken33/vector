import { EngineEvents, RouterSchemas, INodeService } from "@connext/vector-types";
import Ajv from "ajv";
import { BaseLogger } from "pino";

import { forwardTransferCreation, forwardTransferResolution } from "./forwarding";
import { IRouterStore } from "./services/store";

const ajv = new Ajv();

export async function setupListeners(node: INodeService, store: IRouterStore, logger: BaseLogger): Promise<void> {
  // TODO, node should be wrapper around grpc
  // Set up listener to handle transfer creation
  await node.on(
    EngineEvents.CONDITIONAL_TRANSFER_CREATED,
    async data => {
      const res = await forwardTransferCreation(data, node, store, logger);
      if (res.isError) {
        return logger.error(
          { method: "forwardTransferCreation", error: res.getError()?.message, context: res.getError()?.context },
          "Error forwarding transfer",
        );
      }
      logger.info({ method: "forwardTransferCreation", result: res.getValue() }, "Successfully forwarded transfer");
    },
    data => {
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

      if (data.transfer.initiator === node.signerAddress) {
        logger.info(
          { initiator: data.transfer.initiator },
          "Not forwarding transfer which was initiated by our node, doing nothing",
        );
        return false;
      }

      if (!data.transfer.meta.path[0].recipient || data.transfer.meta.path.recipient === node.publicIdentifier) {
        logger.warn({ path: data.transfer.meta.path[0] }, "Not forwarding transfer with no path to follow");
        return false;
      }
      return true;
    },
  );

  // Set up listener to handle transfer resolution
  await node.on(
    EngineEvents.CONDITIONAL_TRANSFER_RESOLVED,
    async data => {
      const res = await forwardTransferResolution(data, node, store, logger);
      if (res.isError) {
        return logger.error(
          { method: "forwardTransferResolution", error: res.getError()?.message, context: res.getError()?.context },
          "Error forwarding resolution",
        );
      }
      logger.info({ method: "forwardTransferResolution", result: res.getValue() }, "Successfully forwarded resolution");
    },
    data => {
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
      if (data.transfer.responder === node.signerAddress) {
        logger.info({ routingId: data.transfer.meta.routingId }, "Nothing to reclaim");
        return false;
      }

      return true;
    },
  );

  await node.on(
    EngineEvents.DEPOSIT_RECONCILED, // TODO types
    async data => {
      // await handleCollateralization(data);
    },
  );

  // node.on(
  //   EngineEvents.IS_ALIVE, // TODO types
  //   async data => {
  //     await handleIsAlive(data);
  //   },
  // );
}
