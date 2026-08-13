const fs = require('fs');
const path = require('path');
const { Redis: UpstashRedis } = require('@upstash/redis');
const IoRedis = require('ioredis');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'emails.json');

// Detect Redis environment variables
const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
const upstashUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let redisClient = null;
let clientType = 'none';

if (redisUrl) {
  try {
    redisClient = new IoRedis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
    });

    // Suppress unhandled socket errors to prevent process termination
    redisClient.on('error', (err) => {
      console.warn('⚠️ Redis Socket Warning:', err.message);
    });

    clientType = 'ioredis';
    console.log('⚡ Connected via REDIS_URL (ioredis)');
  } catch (err) {
    console.error('ioredis connection error:', err);
  }
} else if (upstashUrl && upstashToken) {
  try {
    redisClient = new UpstashRedis({
      url: upstashUrl,
      token: upstashToken,
    });
    clientType = 'upstash';
    console.log('⚡ Connected via Upstash REST API');
  } catch (err) {
    console.error('Upstash REST connection error:', err);
  }
} else {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
  } catch (e) {}
}

let memoryStore = [];

async function readEmails() {
  if (clientType === 'ioredis' && redisClient) {
    try {
      // Use efficient SCAN instead of blocking KEYS
      let keys = [];
      let stream = redisClient.scanStream({ match: 'email:*', count: 100 });
      for await (const resultKeys of stream) {
        keys.push(...resultKeys);
      }
      if (!keys || keys.length === 0) return [];
      const rawItems = await redisClient.mget(keys);
      return rawItems
        .filter(Boolean)
        .map(item => (typeof item === 'string' ? JSON.parse(item) : item));
    } catch (err) {
      console.error('ioredis read error:', err);
      return memoryStore;
    }
  }

  if (clientType === 'upstash' && redisClient) {
    try {
      const keys = await redisClient.keys('email:*');
      if (!keys || keys.length === 0) return [];
      const emails = await redisClient.mget(...keys);
      return emails.filter(Boolean);
    } catch (err) {
      console.error('Upstash read error:', err);
      return memoryStore;
    }
  }

  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryStore = JSON.parse(raw);
      return memoryStore;
    }
  } catch (err) {}

  return memoryStore;
}

async function saveEmailRecord(email) {
  if (clientType === 'ioredis' && redisClient) {
    try {
      await redisClient.set(`email:${email.id}`, JSON.stringify(email));
      return;
    } catch (err) {
      console.error('ioredis save error:', err);
    }
  }

  if (clientType === 'upstash' && redisClient) {
    try {
      await redisClient.set(`email:${email.id}`, email);
      return;
    } catch (err) {
      console.error('Upstash save error:', err);
    }
  }

  try {
    const emails = await readEmails();
    const idx = emails.findIndex(e => e.id === email.id);
    if (idx >= 0) {
      emails[idx] = email;
    } else {
      emails.push(email);
    }
    memoryStore = emails;
    if (fs.existsSync(DATA_DIR)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(emails, null, 2), 'utf-8');
    }
  } catch (err) {}
}

async function getAllEmails() {
  const emails = await readEmails();
  return emails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getEmailById(id) {
  if (clientType === 'ioredis' && redisClient) {
    try {
      const raw = await redisClient.get(`email:${id}`);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {}
  }

  if (clientType === 'upstash' && redisClient) {
    try {
      const email = await redisClient.get(`email:${id}`);
      if (email) return email;
    } catch (err) {}
  }

  const emails = await readEmails();
  return emails.find(e => e.id === id) || null;
}

async function createEmail(data) {
  const newEmail = {
    id: data.id,
    subject: data.subject || 'Untitled Email',
    recipient: data.recipient || 'Unspecified Recipient',
    bodyHtml: data.bodyHtml || '',
    createdAt: new Date().toISOString(),
    openCount: 0,
    firstOpenedAt: null,
    lastOpenedAt: null,
    clickCount: 0,
    opensHistory: [],
    clicksHistory: []
  };

  await saveEmailRecord(newEmail);
  return newEmail;
}

async function recordOpen(id, eventDetails) {
  const email = await getEmailById(id);
  if (!email) return null;

  const now = new Date().toISOString();
  email.openCount = (email.openCount || 0) + 1;
  if (!email.firstOpenedAt) {
    email.firstOpenedAt = now;
  }
  email.lastOpenedAt = now;
  if (!email.opensHistory) email.opensHistory = [];

  email.opensHistory.unshift({
    timestamp: now,
    ip: eventDetails.ip || 'Unknown IP',
    userAgent: eventDetails.userAgent || 'Unknown User-Agent'
  });

  await saveEmailRecord(email);
  return email;
}

async function recordClick(id, eventDetails) {
  const email = await getEmailById(id);
  if (!email) return null;

  const now = new Date().toISOString();
  email.clickCount = (email.clickCount || 0) + 1;
  if (!email.clicksHistory) email.clicksHistory = [];

  email.clicksHistory.unshift({
    timestamp: now,
    ip: eventDetails.ip || 'Unknown IP',
    userAgent: eventDetails.userAgent || 'Unknown User-Agent',
    targetUrl: eventDetails.targetUrl || ''
  });

  await saveEmailRecord(email);
  return email;
}

async function deleteEmail(id) {
  if (clientType === 'ioredis' && redisClient) {
    try {
      await redisClient.del(`email:${id}`);
    } catch (err) {}
  }

  if (clientType === 'upstash' && redisClient) {
    try {
      await redisClient.del(`email:${id}`);
    } catch (err) {}
  }

  try {
    let emails = await readEmails();
    emails = emails.filter(e => e.id !== id);
    memoryStore = emails;
    if (fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(emails, null, 2), 'utf-8');
    }
  } catch (err) {}
}

module.exports = {
  getAllEmails,
  getEmailById,
  createEmail,
  recordOpen,
  recordClick,
  deleteEmail
};
