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
  private broadcasterProducerIds: Map<string, { id: string; kind: string; label: string }> = new Map();
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
    const consumerKeys = Array.from(this.peerConsumers.keys()).filter(key => key.startsWith(`${socketId}:`));
    consumerKeys.forEach(key => this.peerConsumers.delete(key));
    if (this.broadcasterSocketId === socketId) {
      this.broadcasterSocketId = null;
      this.broadcasterProducerIds.clear();
      console.log(`Broadcaster ${socketId} disconnected, cleared broadcaster data`);
    }
    this.notifyViewerCount();
  }

  private notifyViewerCount() {
    const viewerIds = new Set(Array.from(this.peerConsumers.keys()).map(key => key.split(':')[0]));
    const count = viewerIds.size;
    console.log(`Notifying viewer count: ${count} (viewer IDs: ${Array.from(viewerIds)})`);
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
    console.log(`Transport created for peer ${peerId}: ${transport.id}`);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('@close', () => {
      console.log(`Transport closed for peer ${peerId}`);
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
      console.log(`Producer transport connected for peer ${peerId}`);
    }
  }

  async produce(peerId: string, kind: mediasoup.types.MediaKind, rtpParameters: mediasoup.types.RtpParameters, label: string = '') {
    const transport = this.peerTransports.get(peerId)?.producerTransport;
    if (!transport) {
      throw new Error('Producer transport not found');
    }

    const producer = await transport.produce({ kind, rtpParameters });
    const producerKey = `${peerId}:${kind}:${label}`;
    this.peerProducers.set(producerKey, producer);
    if (this.broadcasterSocketId === peerId) {
      this.broadcasterProducerIds.set(`${kind}:${label}`, { id: producer.id, kind, label });
      console.log(`Broadcaster producer ID set: ${producer.id} for ${kind} (${label})`);
      console.log(`Current broadcasterProducerIds:`, Array.from(this.broadcasterProducerIds.entries()));
    }

    producer.on('transportclose', () => {
      console.log(`Producer transport closed for ${kind} (${label})`);
      producer.close();
      this.peerProducers.delete(producerKey);
      if (this.broadcasterSocketId === peerId) {
        this.broadcasterProducerIds.delete(`${kind}:${label}`);
        console.log(`Broadcaster producer cleared for ${kind} (${label})`);
      }
    });

    return producer.id;
  }

  async connectConsumerTransport(peerId: string, dtlsParameters: mediasoup.types.DtlsParameters) {
    const transport = this.peerTransports.get(peerId)?.consumerTransport;
    if (transport) {
      await transport.connect({ dtlsParameters });
      console.log(`Consumer transport connected for peer ${peerId}`);
    }
  }

  async consume(peerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities) {
    if (!this.broadcasterSocketId || this.broadcasterProducerIds.size === 0) {
      throw new Error('No broadcaster available');
    }

    console.log(`Consumer RTP capabilities for peer ${peerId}:`, rtpCapabilities);
    console.log(`Broadcaster producers available:`, Array.from(this.broadcasterProducerIds.entries()));

    const transport = this.peerTransports.get(peerId)?.consumerTransport;
    if (!transport) {
      throw new Error('Consumer transport not found');
    }

    const consumerParams: { producerId: string; id: string; kind: string; rtpParameters: mediasoup.types.RtpParameters; label: string }[] = [];
    for (const [key, { id: producerId, kind, label }] of this.broadcasterProducerIds) {
      const producer = this.peerProducers.get(`${this.broadcasterSocketId}:${key}`);
      if (!producer) {
        console.log(`Producer not found for ${key} (producerId: ${producerId})`);
        continue;
      }
      const canConsume = this.router.canConsume({ producerId, rtpCapabilities });
      console.log(`Can consume producer ${producerId} for ${key} (kind: ${kind}, label: ${label}): ${canConsume}`);
      if (!canConsume) {
        console.log(`Skipping producer ${producerId} due to incompatible RTP capabilities`);
        continue;
      }

      try {
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: kind === 'video',
        });

        this.peerConsumers.set(`${peerId}:${producerId}`, consumer);
        console.log(`Added consumer for peer ${peerId}, producer ${producerId} (${kind}, ${label})`);

        consumer.on('transportclose', () => {
          console.log(`Consumer transport closed for ${producerId}`);
          consumer.close();
          this.peerConsumers.delete(`${peerId}:${producerId}`);
          this.notifyViewerCount();
        });

        consumer.on('producerclose', () => {
          console.log(`Producer closed for ${producerId}`);
          consumer.close();
          this.peerConsumers.delete(`${peerId}:${producerId}`);
          this.notifyViewerCount();
        });

        consumerParams.push({
          producerId,
          id: consumer.id,
          kind,
          rtpParameters: consumer.rtpParameters,
          label,
        });
      } catch (error) {
        console.error(`Error creating consumer for producer ${producerId} (${kind}, ${label}):`, error);
      }
    }

    console.log(`Returning consumerParams for peer ${peerId}:`, consumerParams);

    if (consumerParams.length === 0) {
      throw new Error('No consumable producers available');
    }

    this.notifyViewerCount();
    return consumerParams;
  }

  async resumeConsumer(peerId: string, producerIds: string[]) {
    for (const producerId of producerIds) {
      const consumer = this.peerConsumers.get(`${peerId}:${producerId}`);
      if (consumer) {
        await consumer.resume();
        console.log(`Resumed consumer for peer ${peerId}, producer ${producerId}`);
      }
    }
  }
}