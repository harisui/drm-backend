import { createClient } from 'redis';

// Initialize Redis client
const redisClient = createClient({ url: 'redis://127.0.0.1:6379' });

// Redis connection events
redisClient.on('connect', () => console.log('Connected to Redis...'));
redisClient.on('ready', () => console.log('Redis is ready...'));
redisClient.on('error', (err) => console.error('Redis connection error:', err));

// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('Could not connect to Redis:', err.message);
    }
})();

export default redisClient;
