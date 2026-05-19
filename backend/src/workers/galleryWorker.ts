import { Worker, Job } from 'bullmq';
import { sendGallery } from '../services/galleryDispatch.service.js';

let galleryWorker: Worker | null = null;

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const u = new URL(redisUrl);
    return {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
      username: (u.username && u.username !== 'default') ? u.username : undefined,
      db: parseInt(u.pathname.slice(1) || '0', 10),
      maxRetriesPerRequest: null,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
  };
}

export function startGalleryWorker(): void {
  try {
    const connection = getRedisConnection();

    galleryWorker = new Worker(
      'gallery-dispatch',
      async (job: Job) => {
        const { dispatchId } = job.data;
        console.log(`[GalleryWorker] Processing dispatch ${dispatchId}`);
        await sendGallery(dispatchId);
      },
      {
        connection,
        concurrency: 5,
      }
    );

    galleryWorker.on('completed', (job: any) => {
      console.log(`[GalleryWorker] Job ${job.id} completed`);
    });

    galleryWorker.on('failed', (job: any, err: any) => {
      console.error(`[GalleryWorker] Job ${job?.id} failed:`, err.message);
    });

    console.log('✅ Gallery dispatch worker started');
  } catch (error) {
    console.warn('⚠️  Gallery worker not started (Redis unavailable)');
  }
}

export function stopGalleryWorker(): void {
  if (galleryWorker) {
    galleryWorker.close();
  }
}
