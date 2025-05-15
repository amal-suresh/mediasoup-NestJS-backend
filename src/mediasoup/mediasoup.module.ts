import { Module } from '@nestjs/common';
import { MediasoupGateway } from './mediasoup.gateway';
import { MediasoupService } from './mediasoup.service';

@Module({
  providers: [MediasoupService, MediasoupGateway],
  exports: [MediasoupService], 
})
export class MediasoupModule {}
