import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import {
  Worker,
  Router,
  WorkerSettings,
  RouterOptions,
  WebRtcTransport,
  Producer,
} from 'mediasoup/node/lib/types';

@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker;
  private router: Router;

  private producerTransports = new Map<string, WebRtcTransport>();
  private consumerTransports = new Map<string, WebRtcTransport>();
  private producers = new Map<string, Producer>();

  private workerSettings: WorkerSettings = {
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  };

  private routerOptions: RouterOptions = {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {},
      },
    ],
  };

  async onModuleInit() {
    await this.createWorker();
    await this.createRouter();
  }

  async onModuleDestroy() {
    if (this.router) await this.router.close();
    if (this.worker) await this.worker.close();
  }

  private async createWorker() {
    this.worker = await mediasoup.createWorker(this.workerSettings);
    console.log(`Mediasoup worker created, PID: ${this.worker.pid}`);

    this.worker.on('died', () => {
      console.error('Mediasoup worker died, exiting...');
      setTimeout(() => process.exit(1), 2000);
    });
  }

  private async createRouter() {
    if (!this.worker) throw new Error('Worker not initialized');
    this.router = await this.worker.createRouter(this.routerOptions);
    console.log('Mediasoup router created');
  }

  getRouter(): Router {
    if (!this.router) throw new Error('Router not initialized');
    return this.router;
  }

  // Producer transport methods
  addProducerTransport(clientId: string, transport: WebRtcTransport) {
    this.producerTransports.set(clientId, transport);
  }

  getProducerTransport(clientId: string): WebRtcTransport | undefined {
    return this.producerTransports.get(clientId);
  }

  removeProducerTransport(clientId: string) {
    const transport = this.producerTransports.get(clientId);
    if (transport) transport.close();
    this.producerTransports.delete(clientId);
  }

  // Consumer transport methods
  addConsumerTransport(clientId: string, transport: WebRtcTransport) {
    this.consumerTransports.set(clientId, transport);
  }

  getConsumerTransport(clientId: string): WebRtcTransport | undefined {
    return this.consumerTransports.get(clientId);
  }

  removeConsumerTransport(clientId: string) {
    const transport = this.consumerTransports.get(clientId);
    if (transport) transport.close();
    this.consumerTransports.delete(clientId);
  }

  // Producers management
  addProducer(clientId: string, producer: Producer) {
    this.producers.set(clientId, producer);
  }

  getProducer(clientId: string): Producer | undefined {
    return this.producers.get(clientId);
  }

  removeProducer(clientId: string) {
    const producer = this.producers.get(clientId);
    if (producer) producer.close();
    this.producers.delete(clientId);
  }

  getProducers(): Map<string, Producer> {
  return this.producers;
}
}
