import { Queue, Worker, Job } from 'bullmq';

// Redis connection for BullMQ — supports REDIS_URL or REDIS_HOST/PORT
const getRedisConnection = () => {
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
};

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
