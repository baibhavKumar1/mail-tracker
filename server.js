const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket.remoteAddress || 'Unknown';
}

const pixelHandler = (req, res) => {
  const emailId = req.params.id.replace(/\.png$/i, '');
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(TRANSPARENT_PNG);

  setImmediate(() => {
    db.recordOpen(emailId, { ip, userAgent }).catch(err => {
      console.error('Background recordOpen error:', err);
    });
  });
};

app.get('/track/:id.png', pixelHandler);
app.get('/track/:id', pixelHandler);
app.get('/media/v1/:id.png', pixelHandler);
app.get('/media/v1/:id', pixelHandler);

app.get('/click/:id', (req, res) => {
  const emailId = req.params.id;
  const targetUrl = req.query.url;
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';

  setImmediate(() => {
    db.recordClick(emailId, { ip, userAgent, targetUrl }).catch(err => {
      console.error('Background recordClick error:', err);
    });
  });

  if (targetUrl) {
    let finalUrl = targetUrl;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }
    return res.redirect(finalUrl);
  }

  res.status(400).send('Missing target URL');
});

app.get('/api/emails', async (req, res) => {
  try {
    const emails = await db.getAllEmails();
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve emails' });
  }
});

app.post('/api/emails', async (req, res) => {
  try {
    const { subject, recipient, bodyHtml } = req.body;
    const id = uuidv4();

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const trackingPixelUrl = `${baseUrl}/media/v1/${id}.png`;
    const pixelTag = `<img src="${trackingPixelUrl}" alt="" width="1" height="1" style="display:none !important; width:1px; height:1px; border:0; opacity:0;" />`;

    let processedHtml = bodyHtml || '';
    if (processedHtml.trim().length > 0) {
      processedHtml += `\n${pixelTag}`;
    } else {
      processedHtml = pixelTag;
    }

    const created = await db.createEmail({
      id,
      subject: subject || 'Untitled Email',
      recipient: recipient || 'Unspecified Recipient',
      bodyHtml: processedHtml
    });

    res.status(201).json({
      ...created,
      trackingPixelUrl,
      pixelTag
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create email' });
  }
});

app.get('/api/emails/:id', async (req, res) => {
  try {
    const email = await db.getEmailById(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json(email);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch email details' });
  }
});

app.delete('/api/emails/:id', async (req, res) => {
  try {
    await db.deleteEmail(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

app.post('/api/emails/simulate-open/:id', async (req, res) => {
  try {
    const emailId = req.params.id;
    const updated = await db.recordOpen(emailId, {
      ip: '127.0.0.1 (Simulated)',
      userAgent: 'Simulated Recipient (Dashboard Action)'
    });
    if (!updated) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to simulate open' });
  }
});

app.post('/api/emails/wrap-links', (req, res) => {
  const { html, id } = req.body;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = `${protocol}://${host}`;

  if (!html || !id) {
    return res.status(400).json({ error: 'Missing html or id' });
  }

  const wrappedHtml = html.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"/gi, (match, url) => {
    if (url.startsWith('#') || url.startsWith('mailto:') || url.includes('/click/')) {
      return match;
    }
    const trackedUrl = `${baseUrl}/click/${id}?url=${encodeURIComponent(url)}`;
    return match.replace(url, trackedUrl);
  });

  res.json({ wrappedHtml });
});

app.post('/api/emails/send-test', async (req, res) => {
  const { to, subject, html, smtpConfig } = req.body;

  try {
    let transporter;

    const host = smtpConfig?.host || process.env.SMTP_HOST;
    const port = smtpConfig?.port || process.env.SMTP_PORT || 587;
    const user = smtpConfig?.user || process.env.SMTP_USER;
    const pass = smtpConfig?.pass || process.env.SMTP_PASS;

    if (host && user && pass) {
      transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: port == 465,
        auth: { user, pass }
      });
    } else {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    }

    const fromAddress = process.env.SMTP_FROM || user || '"MailTracker" <tracker@wishop.xyz>';

    const info = await transporter.sendMail({
      from: fromAddress,
      to: to || 'recipient@example.com',
      subject: subject || 'Tracked Email',
      html: html
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    res.json({
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      note: previewUrl ? 'Sent via Ethereal SMTP test sandbox.' : 'Sent successfully via Custom SMTP!'
    });
  } catch (err) {
    console.error('SMTP Error:', err.message);
    res.status(500).json({ error: 'Failed to send email via SMTP' });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mail Tracker Service running at http://localhost:${PORT}`);
  });
}
