import { Worker, Job } from 'bullmq';
import { sendGallery } from '../services/galleryDispatch.service.js';

let galleryWorker: Worker | null = null;

export function startGalleryWorker(): void {
  try {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
    };

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

    galleryWorker.on('completed', (job) => {
      console.log(`[GalleryWorker] Job ${job.id} completed`);
    });

    galleryWorker.on('failed', (job, err) => {
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
