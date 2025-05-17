import { Module } from '@nestjs/common';
import { MediasoupGateway } from './mediasoup/mediasoup.gateway';
import { MediasoupService } from './mediasoup/mediasoup.service';

@Module({
  imports: [],
  providers: [MediasoupGateway, MediasoupService],
})
export class AppModule {}