import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MediasoupService } from './mediasoup.service';
import { Injectable } from '@nestjs/common';
import type { MediaKind } from 'mediasoup/node/lib/types';

@WebSocketGateway({
  namespace: '/mediasoup',
  cors: {
    origin: '*',
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

    // Cleanup transports and producers on disconnect
    this.mediasoupService.removeProducerTransport(client.id);
    this.mediasoupService.removeConsumerTransport(client.id);
    this.mediasoupService.removeProducer(client.id);
  }

  @SubscribeMessage('getRouterRtpCapabilities')
  handleGetRouterRtpCapabilities(@ConnectedSocket() client: Socket) {
    try {
      const router = this.mediasoupService.getRouter();
      client.emit('routerRtpCapabilities', router.rtpCapabilities);
    } catch (error) {
      console.error('Error getting RTP Capabilities:', error);
      client.emit('error', 'Router not ready');
    }
  }

  @SubscribeMessage('createWebRtcTransport')
  async handleCreateWebRtcTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sender: boolean },
  ) {
    try {
      if (!payload || typeof payload.sender !== 'boolean') {
        client.emit('createWebRtcTransport', { error: 'Invalid payload' });
        return;
      }

      const router = this.mediasoupService.getRouter();

      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0' }], // Change IP as needed
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      const transportParams = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };

      if (payload.sender) {
        this.mediasoupService.addProducerTransport(client.id, transport);
      } else {
        this.mediasoupService.addConsumerTransport(client.id, transport);
      }

      client.emit('createWebRtcTransport', { params: transportParams });

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') transport.close();
      });

      transport.on('@close', () => {
        console.log('Transport closed');
      });
    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      client.emit('createWebRtcTransport', { error: error.message });
    }
  }
@SubscribeMessage('transport-produce')
async handleTransportProduce(
  @ConnectedSocket() client: Socket,
  @MessageBody()
  payload: { transportId: string; kind: string; rtpParameters: any; appData?: any }
) {
  try {
    const { transportId, kind, rtpParameters, appData } = payload;
    console.log(`Received transport-produce for transport: ${transportId}, kind: ${kind}`);
    
    const transport = this.mediasoupService.getProducerTransport(client.id);

    if (!transport || transport.id !== transportId) {
      // Use the acknowledgement pattern with the Socket.io client directly
      client.emit('transport-produce-response', { error: 'Transport not found' });
      return { error: 'Transport not found' };
    }

    if (kind !== 'audio' && kind !== 'video') {
      client.emit('transport-produce-response', { error: 'Invalid media kind' });
      return { error: 'Invalid media kind' };
    }

    const mediaKind = kind as MediaKind;

    const producer = await transport.produce({
      kind: mediaKind,
      rtpParameters,
      appData,
    });

    console.log("Producer created:", producer.id, producer.kind);

    this.mediasoupService.addProducer(client.id, producer);
    
    // Return the producer ID through a direct emit
    const response = { id: producer.id };
    client.emit('transport-produce-response', response);
    
    // Also return for Socket.io acknowledgement in case it's supported
    return response;
  } catch (error) {
    console.error('Error in transport-produce:', error);
    client.emit('transport-produce-response', { error: error.message });
    return { error: error.message };
  }
}

@SubscribeMessage('transport-connect')
async handleTransportConnect(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: { transportId: string; dtlsParameters: any }
) {
  try {
    const { transportId, dtlsParameters } = payload;
    console.log(`Received transport-connect for transport: ${transportId}`);
    
    // Try to get producer transport first
    let transport = this.mediasoupService.getProducerTransport(client.id);
    
    // If not found, try consumer transport
    if (!transport || transport.id !== transportId) {
      transport = this.mediasoupService.getConsumerTransport(client.id);
    }

    if (!transport || transport.id !== transportId) {
      console.error(`Transport ${transportId} not found for client ${client.id}`);
      client.emit('transport-connect-response', { success: false, error: 'Transport not found' });
      return;
    }

    await transport.connect({ dtlsParameters });
    console.log(`Transport ${transportId} connected successfully`);
    
    // Send success response via an emit rather than a callback
    client.emit('transport-connect-response', { success: true });
  } catch (error) {
    console.error('Error connecting transport:', error);
    client.emit('transport-connect-response', { success: false, error: error.message });
  }
}

@SubscribeMessage('get-producers')
handleGetProducers(@ConnectedSocket() client: Socket) {
  // For a simple 1:1 use case, we're just looking for producers that aren't from the current client
  // Define a proper type for the producers array
  const producers: { producerId: string; clientId: string; kind: string }[] = [];
  
  // Iterate through all clients with producers
  this.mediasoupService.getProducers().forEach((producer, clientId) => {
    // Only include producers from other clients (not the requesting client)
    if (clientId !== client.id) {
      producers.push({
        producerId: producer.id,
        clientId: clientId,
        kind: producer.kind
      });
    }
  });
  
  client.emit('producers-list', { producers });
}

@SubscribeMessage('consume')
async handleConsume(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: { 
    transportId: string;
    remoteProducerId: string;
    rtpCapabilities: any;
  }
) {
  try {
    const { transportId, remoteProducerId, rtpCapabilities } = payload;
    console.log(`Received consume request for producer: ${remoteProducerId}`);
    
    const router = this.mediasoupService.getRouter();
    
    // Check if consumer can consume the producer
    if (!router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
      client.emit('consume', { 
        error: 'Cannot consume the producer with provided RTP capabilities'
      });
      return;
    }
    
    // Get consumer transport
    const transport = this.mediasoupService.getConsumerTransport(client.id);
    if (!transport || transport.id !== transportId) {
      client.emit('consume', { error: 'Transport not found' });
      return;
    }
    
    // Create consumer
    const consumer = await transport.consume({
      producerId: remoteProducerId,
      rtpCapabilities,
      paused: true  // Start paused, will be resumed by client
    });
    
    console.log(`Consumer created for client ${client.id}, consuming producer ${remoteProducerId}`);
    
    // Send consumer parameters to client
    client.emit('consume', {
      params: {
        id: consumer.id,
        producerId: remoteProducerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      }
    });
    
    // Handle consumer-resume request
    client.once('consumer-resume', async () => {
      console.log(`Resuming consumer ${consumer.id}`);
      await consumer.resume();
    });
  } catch (error) {
    console.error('Error in consume:', error);
    client.emit('consume', { error: error.message });
  }
}

}
