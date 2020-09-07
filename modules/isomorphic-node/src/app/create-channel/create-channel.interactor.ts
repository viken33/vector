import { ApplicationErrorFactory } from '../core/definitions/application-error-factory';
import { Interactor } from '../core/definitions/interactor';
import { CreateChannelInput } from './create-channel.in';
import { CreateChannelOutput } from './create-channel.out';
import { CreateChannelValidator } from './create-channel.validator';
import { ErrorType } from '../core/definitions/error-type';
import { IWalletService } from '../core/definitions/wallet.service';
import { constants } from 'ethers';

export class CreateChannelInteractor implements Interactor {
  constructor(
    private createChannelValidator: CreateChannelValidator,
    private walletService: IWalletService,
    private errorFactory: ApplicationErrorFactory,
  ) {}

  async execute(request: CreateChannelInput): Promise<CreateChannelOutput> {
    const result = this.createChannelValidator.validate(request);

    if (!result.valid) {
      throw this.errorFactory.getError(ErrorType.validation, result.error);
    }

    try {
      const channelId = constants.HashZero;
      await this.walletService.setup({
        chainId: request.chainId,
        channelId, // TODO: generate from identifiers
        participants: [this.walletService.getPublicIdentifier(), request.publicIdentifier],
      });

      return { channelId };
    } catch (error) {
      throw this.errorFactory.getError(ErrorType.createChannel, error);
    }
  }
}
