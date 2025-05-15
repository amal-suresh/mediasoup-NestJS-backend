import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import {
  Worker,
  Router,
  WorkerSettings,
  RouterOptions,
} from 'mediasoup/node/lib/types';

@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker;
  private router: Router;

  // You can tweak settings or pull from config
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
    if (this.router) {
      await this.router.close();
    }
    if (this.worker) {
      await this.worker.close();
    }
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
    if (!this.worker) {
      throw new Error('Worker not initialized yet');
    }
    this.router = await this.worker.createRouter(this.routerOptions);
    console.log('Mediasoup router created');
  }

  getWorker(): Worker {
    if (!this.worker) {
      throw new Error('Worker not initialized yet');
    }
    return this.worker;
  }

  getRouter(): Router {
    if (!this.router) {
      throw new Error('Router not initialized yet');
    }
    return this.router;
  }
}
