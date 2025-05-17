import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MediasoupService } from './mediasoup.service';
import * as mediasoup from 'mediasoup';

@WebSocketGateway({ namespace: '/mediasoup', cors: { origin: 'http://localhost:3000', credentials: true } })
export class MediasoupGateway {
  @WebSocketServer() server: Server;

  constructor(private readonly mediasoupService: MediasoupService) {
    this.mediasoupService.setViewerCountCallback((count: number) => {
      const broadcasterSocketId = this.mediasoupService.getBroadcasterSocketId();
      if (broadcasterSocketId) {
        console.log(`Emitting viewerCount ${count} to broadcaster ${broadcasterSocketId}`);
        this.server.to(broadcasterSocketId).emit('viewerCount', { count });
        console.log(`Sent viewer count ${count} to broadcaster ${broadcasterSocketId}`);
      } else {
        console.log('No broadcaster socket ID available for viewerCount emission');
      }
    });
  }

  handleConnection(socket: Socket) {
    console.log(`Peer connected: ${socket.id}`);
    socket.emit('connection-success', { socketId: socket.id });
  }

  handleDisconnect(socket: Socket) {
    console.log(`Peer disconnected: ${socket.id}`);
    this.mediasoupService.handleDisconnect(socket.id);
    if (this.mediasoupService.isBroadcaster(socket.id)) {
      this.server.emit('broadcasterDisconnected');
      console.log(`Notified all clients of broadcaster disconnection`);
    }
  }

  @SubscribeMessage('setBroadcaster')
  handleSetBroadcaster(socket: Socket) {
    console.log(`Socket ${socket.id} set as broadcaster`);
    this.mediasoupService.setBroadcaster(socket.id);
    return { success: true };
  }

  @SubscribeMessage('getRouterRtpCapabilities')
  handleGetRouterRtpCapabilities(socket: Socket) {
    const routerRtpCapabilities = this.mediasoupService.getRouterRtpCapabilities();
    console.log(`Sending routerRtpCapabilities for socket ${socket.id}:`, routerRtpCapabilities);
    return { routerRtpCapabilities };
  }

  @SubscribeMessage('createTransport')
  async handleCreateTransport(socket: Socket, { sender }: { sender: boolean }) {
    try {
      const transport = await this.mediasoupService.createWebRtcTransport(socket.id, sender);
      console.log(`Created transport for socket ${socket.id}, sender: ${sender}`, transport.id);
      return {
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      };
    } catch (error) {
      console.error(`Error creating transport for socket ${socket.id}:`, error);
      return { params: { error: error.message } };
    }
  }

  @SubscribeMessage('connectProducerTransport')
  async handleConnectProducerTransport(socket: Socket, { dtlsParameters }: { dtlsParameters: mediasoup.types.DtlsParameters }) {
    console.log(`Connecting producer transport for socket ${socket.id}`);
    await this.mediasoupService.connectProducerTransport(socket.id, dtlsParameters);
    return { success: true };
  }

  @SubscribeMessage('transport-produce')
  async handleTransportProduce(
    socket: Socket,
    { kind, rtpParameters, label }: { kind: mediasoup.types.MediaKind; rtpParameters: mediasoup.types.RtpParameters; label: string }
  ) {
    console.log(`Producing for socket ${socket.id}, kind: ${kind}, label: ${label}`);
    const producerId = await this.mediasoupService.produce(socket.id, kind, rtpParameters, label);
    console.log(`Produced, producer ID: ${producerId}`);
    return { id: producerId };
  }

  @SubscribeMessage('connectConsumerTransport')
  async handleConnectConsumerTransport(socket: Socket, { dtlsParameters }: { dtlsParameters: mediasoup.types.DtlsParameters }) {
    console.log(`Connecting consumer transport for socket ${socket.id}`);
    await this.mediasoupService.connectConsumerTransport(socket.id, dtlsParameters);
    return { success: true };
  }

  @SubscribeMessage('consumeMedia')
  async handleConsumeMedia(socket: Socket, { rtpCapabilities }: { rtpCapabilities: mediasoup.types.RtpCapabilities }) {
    try {
      console.log(`Consuming media for socket ${socket.id}`);
      const consumerParams = await this.mediasoupService.consume(socket.id, rtpCapabilities);
      console.log(`Consumer params for socket ${socket.id}:`, consumerParams);
      return { params: consumerParams };
    } catch (error) {
      console.error(`Error consuming media for socket ${socket.id}:`, error);
      return { params: { error: error.message } };
    }
  }

  @SubscribeMessage('resumePausedConsumers')
  async handleResumePausedConsumers(socket: Socket, producerIds: string[]) {
    console.log(`Resuming consumers for socket ${socket.id}, producerIds:`, producerIds);
    await this.mediasoupService.resumeConsumer(socket.id, producerIds);
    return { success: true };
  }
}