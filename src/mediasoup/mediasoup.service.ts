import { Injectable } from '@nestjs/common';
import * as mediasoup from 'mediasoup';

@Injectable()
export class MediasoupService {
  private worker: mediasoup.types.Worker;
  private router: mediasoup.types.Router;
  private peerTransports: Map<string, { producerTransport?: mediasoup.types.WebRtcTransport; consumerTransport?: mediasoup.types.WebRtcTransport }> = new Map();
  private peerProducers: Map<string, mediasoup.types.Producer> = new Map();
  private peerConsumers: Map<string, mediasoup.types.Consumer> = new Map();
  private broadcasterSocketId: string | null = null;
  private broadcasterProducerId: string | null = null;
  private viewerCountCallback: (count: number) => void = () => {};

  constructor() {
    this.initialize();
  }

  setViewerCountCallback(callback: (count: number) => void) {
    this.viewerCountCallback = callback;
  }

  getBroadcasterSocketId(): string | null {
    return this.broadcasterSocketId;
  }

  private async initialize() {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 2000,
      rtcMaxPort: 2020,
    });

    console.log(`Worker process ID ${this.worker.pid}`);
    this.worker.on('died', () => {
      console.error('mediasoup worker has died');
      setTimeout(() => process.exit(), 2000);
    });

    const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 96,
        rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }],
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
        preferredPayloadType: 97,
        rtcpFeedback: [{ type: 'nack' }, { type: 'ccm', parameter: 'fir' }, { type: 'goog-remb' }],
      },
    ];

    this.router = await this.worker.createRouter({ mediaCodecs });
  }

  setBroadcaster(socketId: string) {
    this.broadcasterSocketId = socketId;
    console.log(`Broadcaster set to socket ${socketId}`);
    this.notifyViewerCount();
  }

  isBroadcaster(socketId: string): boolean {
    return this.broadcasterSocketId === socketId;
  }

  handleDisconnect(socketId: string) {
    this.peerTransports.delete(socketId);
    this.peerProducers.delete(socketId);
    this.peerConsumers.delete(socketId);
    if (this.broadcasterSocketId === socketId) {
      this.broadcasterSocketId = null;
      this.broadcasterProducerId = null;
      console.log(`Broadcaster ${socketId} disconnected, cleared broadcaster data`);
    }
    this.notifyViewerCount();
  }

  private notifyViewerCount() {
    const count = this.peerConsumers.size;
    console.log(`Notifying viewer count: ${count}`);
    this.viewerCountCallback(count);
  }

  getRouterRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(peerId: string, sender: boolean) {
    const webRtcTransportOptions = {
      listenIps: [{ ip: '127.0.0.1' }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await this.router.createWebRtcTransport(webRtcTransportOptions);
    console.log(`Transport created: ${transport.id}`);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('@close', () => {
      console.log('Transport closed');
    });

    if (!this.peerTransports.has(peerId)) {
      this.peerTransports.set(peerId, {});
    }
    const peer = this.peerTransports.get(peerId)!;
    if (sender) {
      peer.producerTransport = transport;
    } else {
      peer.consumerTransport = transport;
    }

    return transport;
  }

  async connectProducerTransport(peerId: string, dtlsParameters: mediasoup.types.DtlsParameters) {
    const transport = this.peerTransports.get(peerId)?.producerTransport;
    if (transport) {
      await transport.connect({ dtlsParameters });
    }
  }

  async produce(peerId: string, kind: mediasoup.types.MediaKind, rtpParameters: mediasoup.types.RtpParameters) {
    const transport = this.peerTransports.get(peerId)?.producerTransport;
    if (!transport) {
      throw new Error('Producer transport not found');
    }

    const producer = await transport.produce({ kind, rtpParameters });
    this.peerProducers.set(peerId, producer);
    if (this.broadcasterSocketId === peerId) {
      this.broadcasterProducerId = producer.id;
      console.log(`Broadcaster producer ID set: ${producer.id}`);
    }

    producer.on('transportclose', () => {
      console.log('Producer transport closed');
      producer.close();
      this.peerProducers.delete(peerId);
      if (this.broadcasterProducerId === producer.id) {
        this.broadcasterProducerId = null;
        console.log(`Broadcaster producer cleared`);
      }
    });

    return producer.id;
  }

  async connectConsumerTransport(peerId: string, dtlsParameters: mediasoup.types.DtlsParameters) {
    const transport = this.peerTransports.get(peerId)?.consumerTransport;
    if (transport) {
      await transport.connect({ dtlsParameters });
    }
  }

  async consume(peerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities) {
    if (!this.broadcasterProducerId || !this.broadcasterSocketId || !this.peerProducers.has(this.broadcasterSocketId)) {
      throw new Error('No broadcaster available');
    }
    const producer = this.peerProducers.get(this.broadcasterSocketId);
    if (!producer || !this.router.canConsume({ producerId: this.broadcasterProducerId, rtpCapabilities })) {
      throw new Error('Cannot consume broadcaster stream');
    }

    const transport = this.peerTransports.get(peerId)?.consumerTransport;
    if (!transport) {
      throw new Error('Consumer transport not found');
    }

    const consumer = await transport.consume({
      producerId: this.broadcasterProducerId,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });

    this.peerConsumers.set(peerId, consumer);
    this.notifyViewerCount();

    consumer.on('transportclose', () => {
      console.log('Consumer transport closed');
      consumer.close();
      this.peerConsumers.delete(peerId);
      this.notifyViewerCount();
    });

    consumer.on('producerclose', () => {
      console.log('Producer closed');
      consumer.close();
      this.peerConsumers.delete(peerId);
      this.notifyViewerCount();
    });

    return {
      producerId: this.broadcasterProducerId,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(peerId: string) {
    const consumer = this.peerConsumers.get(peerId);
    if (consumer) {
      await consumer.resume();
    }
  }
}