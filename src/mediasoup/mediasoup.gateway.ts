import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MediasoupService } from './mediasoup.service';  // adjust path as needed
import { Injectable } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/mediasoup',
  cors: {
    origin: '*', // adjust for your frontend origin in production
  },
})
@Injectable()
export class MediasoupGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly mediasoupService: MediasoupService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
    client.emit('connection-success', { socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('getRouterRtpCapabilities')
  handleGetRouterRtpCapabilities(@ConnectedSocket() client: Socket) {
    try {
      const router = this.mediasoupService.getRouter();
      const rtpCapabilities = router.rtpCapabilities;
      client.emit('routerRtpCapabilities', rtpCapabilities);
    } catch (error) {
      console.error('Error getting RTP Capabilities:', error);
      client.emit('error', 'Router not ready');
    }
  }
}
