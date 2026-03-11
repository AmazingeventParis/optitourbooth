import { Queue, Worker, Job } from 'bullmq';

// Redis connection for BullMQ (reuses same Redis instance config)
const getRedisConnection = () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

// Track if queues are available
let queuesAvailable = false;

// Gallery dispatch queue
export let galleryQueue: Queue | null = null;

// Review processing queue
export let reviewQueue: Queue | null = null;

export function initializeQueues(): void {
  try {
    const connection = getRedisConnection();

    galleryQueue = new Queue('gallery-dispatch', { connection });
    reviewQueue = new Queue('review-processing', { connection });

    queuesAvailable = true;
    console.log('✅ BullMQ queues initialized');
  } catch (error) {
    console.warn('⚠️  BullMQ queues not available - delayed jobs disabled', error);
    queuesAvailable = false;
  }
}

export function areQueuesAvailable(): boolean {
  return queuesAvailable;
}

export { Queue, Worker, Job };
